import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPlayer, once, onceMatching, startServer, teardown, walkToDoor, type TestServer } from "./helpers.js";
import type { PresenceSnapshot } from "@metaverse/shared";

/**
 * Social-arrival read model at the socket boundary (PRD 25.26). Asserts that the
 * server broadcasts a `presence-snapshot` on arrival and re-broadcasts it when a
 * student's authoritative activity changes (entering a private room), through the
 * real Socket.IO server booted on an ephemeral port.
 */

let server: TestServer;
let base: string;
const liveSockets: ClientSocket[] = [];

function connect(token: string): ClientSocket {
  const socket = io(base, { transports: ["websocket"], auth: { token }, reconnection: false });
  liveSockets.push(socket);
  return socket;
}

async function joinAs(token: string) {
  const socket = connect(token);
  await once(socket, "connect");
  const init = once<{ selfId: string }>(socket, "init");
  socket.emit("join", { spaceId: "1" });
  return { socket, selfId: (await init).selfId };
}

const personFor = (snapshot: PresenceSnapshot, id: string) => snapshot.people.find((p) => p.id === id);

beforeAll(async () => {
  server = await startServer();
  base = server.baseUrl;
});

afterEach(() => {
  for (const socket of liveSockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await teardown(server);
});

describe("presence read model over the socket boundary", () => {
  it("broadcasts a snapshot placing the arriving student in the open world", async () => {
    const user = await createPlayer("pres-a");
    const socket = connect(user.token);
    await once(socket, "connect");
    const snapshot = once<PresenceSnapshot>(socket, "presence-snapshot");
    socket.emit("join", { spaceId: "1" });
    const snap = await snapshot;
    // selfId equals the user's id (server identity), so assert against it.
    expect(snap.spaceId).toBe("1");
    const self = personFor(snap, user.id);
    // Space "1" is shared serially across suites; assert only about this student,
    // not global emptiness (a prior suite's grace-timer player may still linger).
    expect(self).toMatchObject({ id: user.id, activity: "world", place: null });
  });

  it("re-broadcasts including a second arrival", async () => {
    const first = await createPlayer("pres-b1");
    const a = await joinAs(first.token);

    const second = await createPlayer("pres-b2");
    // The already-present student receives an updated snapshot naming both.
    const bothVisible = onceMatching<PresenceSnapshot>(
      a.socket,
      "presence-snapshot",
      (snap) => Boolean(personFor(snap, a.selfId)) && snap.people.length >= 2,
    );
    const b = connect(second.token);
    await once(b, "connect");
    b.emit("join", { spaceId: "1" });
    const snap = await bothVisible;
    expect(personFor(snap, second.id)?.activity).toBe("world");
  });

  it("moves a student to the 'room' activity when they enter a private room", async () => {
    const user = await createPlayer("pres-c");
    const { socket, selfId } = await joinAs(user.token);
    // First knocker into an empty room walks in as admin (PRD 14).
    walkToDoor(socket, "1");
    const approved = once<{ result: string }>(socket, "knock-result");
    socket.emit("knock", { roomId: "1" });
    expect((await approved).result).toBe("approved");

    const inRoom = onceMatching<PresenceSnapshot>(
      socket,
      "presence-snapshot",
      (snap) => personFor(snap, selfId)?.activity === "room",
    );
    const snap = await inRoom;
    expect(snap.activeSpaces.some((s) => s.kind === "room" && s.id === "1")).toBe(true);
  });
});
