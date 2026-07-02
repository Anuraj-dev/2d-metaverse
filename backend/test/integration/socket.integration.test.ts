import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPlayer, expectSilence, once, onceMatching, sleep, startServer, teardown, type TestServer } from "./helpers.js";

// setup.ts shrinks these for the suite (defaults are 10s / 4s in production).
const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS);
const LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS);

let server: TestServer;
let base: string;
const liveSockets: ClientSocket[] = [];

function connect(token: string): ClientSocket {
  const socket = io(base, { transports: ["websocket"], auth: { token }, reconnection: false });
  liveSockets.push(socket);
  return socket;
}

/** Connect and join space 1, returning the socket and the init payload. */
async function joinAs(token: string) {
  const socket = connect(token);
  await once(socket, "connect");
  const init = once<{ selfId: string; players: Array<{ id: string }> }>(socket, "init");
  socket.emit("join", { spaceId: "1" });
  return { socket, init: await init };
}

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

describe("connection auth", () => {
  it("rejects an invalid token with connect_error unauthorized", async () => {
    const socket = connect("not-a-jwt");
    const error = await once<Error>(socket, "connect_error");
    expect(error.message).toBe("unauthorized");
  });

  it("rejects a missing token", async () => {
    const socket = io(base, { transports: ["websocket"], reconnection: false });
    liveSockets.push(socket);
    const error = await once<Error>(socket, "connect_error");
    expect(error.message).toBe("unauthorized");
  });
});

describe("join", () => {
  it("inits the joiner and broadcasts player-joined to peers", async () => {
    const userA = await createPlayer("ja");
    const userB = await createPlayer("jb");

    const a = await joinAs(userA.token);
    expect(a.init.players.some((player) => player.id === a.init.selfId)).toBe(true);

    const joinedSeen = once<{ id: string }>(a.socket, "player-joined");
    const b = await joinAs(userB.token);
    expect(b.init.players.some((player) => player.id === a.init.selfId)).toBe(true);
    expect((await joinedSeen).id).toBe(b.init.selfId);
  });

  it("disconnects a join to an unknown space", async () => {
    const user = await createPlayer("jx");
    const socket = connect(user.token);
    await once(socket, "connect");
    const gone = once(socket, "disconnect");
    socket.emit("join", { spaceId: "no-such-space" });
    await gone;
    expect(socket.connected).toBe(false);
  });

  it("disconnects a socket that never joins after the join timeout", async () => {
    const user = await createPlayer("jt");
    const socket = connect(user.token);
    await once(socket, "connect");
    const gone = once(socket, "disconnect", JOIN_TIMEOUT_MS * 4);
    await gone;
    expect(socket.connected).toBe(false);
  });
});

describe("movement and chat", () => {
  it("broadcasts moves to peers but not back to the mover", async () => {
    const a = await joinAs((await createPlayer("ma")).token);
    const b = await joinAs((await createPlayer("mb")).token);

    const seen = once(b.socket, "player-moved");
    a.socket.emit("move", { x: 321, y: 288, dir: "right" });
    expect(await seen).toEqual({ id: a.init.selfId, x: 321, y: 288, dir: "right" });
    await expectSilence(a.socket, "player-moved");
  });

  it("ignores malformed move payloads", async () => {
    const a = await joinAs((await createPlayer("mma")).token);
    const b = await joinAs((await createPlayer("mmb")).token);
    a.socket.emit("move", { x: -5, y: 0, dir: "sideways" });
    await expectSilence(b.socket, "player-moved");
  });

  it("delivers world chat to the whole space", async () => {
    const a = await joinAs((await createPlayer("ca")).token);
    const b = await joinAs((await createPlayer("cb")).token);
    const seen = once(b.socket, "chat");
    a.socket.emit("chat", { text: "hello world" });
    expect(await seen).toMatchObject({ id: a.init.selfId, text: "hello world", scope: "world" });
  });
});

describe("whisper", () => {
  it("delivers to the target and echoes to the sender; fails for unknown targets", async () => {
    const a = await joinAs((await createPlayer("wa")).token);
    const b = await joinAs((await createPlayer("wb")).token);

    const received = once(b.socket, "whisper");
    const echoed = once(a.socket, "whisper");
    a.socket.emit("whisper", { to: b.init.selfId, text: "psst" });
    expect(await received).toMatchObject({ from: a.init.selfId, to: b.init.selfId, text: "psst" });
    expect(await echoed).toMatchObject({ from: a.init.selfId, text: "psst" });

    const failed = once(a.socket, "whisper-fail");
    a.socket.emit("whisper", { to: "nobody-here", text: "psst" });
    expect(await failed).toEqual({ name: "nobody-here" });
  });

  it("drops the 21st whisper inside the rate-limit window", async () => {
    const a = await joinAs((await createPlayer("wra")).token);
    const b = await joinAs((await createPlayer("wrb")).token);

    for (let index = 0; index < 20; index += 1) {
      const echoed = once(a.socket, "whisper");
      a.socket.emit("whisper", { to: b.init.selfId, text: `msg ${index}` });
      await echoed;
    }
    a.socket.emit("whisper", { to: b.init.selfId, text: "one too many" });
    await expectSilence(a.socket, "whisper");
    await expectSilence(b.socket, "whisper", 50);
  });
});

describe("room keys", () => {
  it("rejects a wrong key then accepts the right one", async () => {
    const a = await joinAs((await createPlayer("rka")).token);

    const rejected = once(a.socket, "room-enter-result");
    a.socket.emit("room-enter", { roomId: "1", key: "wrong" });
    expect(await rejected).toEqual({ ok: false, roomId: "1", reason: "bad-key" });

    const accepted = once(a.socket, "room-enter-result");
    a.socket.emit("room-enter", { roomId: "1", key: process.env.ROOM_1_KEY });
    expect(await accepted).toEqual({ ok: true, roomId: "1" });
  });

  it("locks out brute force after five attempts, even with the right key", async () => {
    const a = await joinAs((await createPlayer("rkb")).token);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = once(a.socket, "room-enter-result");
      a.socket.emit("room-enter", { roomId: "2", key: "wrong" });
      expect(await result).toEqual({ ok: false, roomId: "2", reason: "bad-key" });
    }
    const locked = once(a.socket, "room-enter-result");
    a.socket.emit("room-enter", { roomId: "2", key: process.env.ROOM_2_KEY });
    expect(await locked).toEqual({ ok: false, roomId: "2", reason: "rate-limited" });
  });

  it("scopes room chat to room members only", async () => {
    const a = await joinAs((await createPlayer("rca")).token);
    const b = await joinAs((await createPlayer("rcb")).token);

    const entered = once(a.socket, "room-enter-result");
    a.socket.emit("room-enter", { roomId: "3", key: process.env.ROOM_3_KEY });
    expect(await entered).toMatchObject({ ok: true });

    const ownEcho = once(a.socket, "chat");
    a.socket.emit("chat", { text: "room secret" });
    expect(await ownEcho).toMatchObject({ text: "room secret", scope: "3" });
    await expectSilence(b.socket, "chat");
  });
});

describe("seats", () => {
  it("broadcasts sit and stand, and reports conflicts to the loser", async () => {
    const userA = await createPlayer("sa");
    const userB = await createPlayer("sb");
    const a = await joinAs(userA.token);
    const b = await joinAs(userB.token);

    for (const player of [a, b]) {
      const entered = once(player.socket, "room-enter-result");
      player.socket.emit("room-enter", { roomId: "4", key: process.env.ROOM_4_KEY });
      expect(await entered).toMatchObject({ ok: true, roomId: "4" });
    }

    const sitSeenByB = once(b.socket, "seat-update");
    a.socket.emit("seat-sit", { roomId: "4", seatId: 0 });
    expect(await sitSeenByB).toEqual({ roomId: "4", seatId: 0, playerId: a.init.selfId });

    // B contests the same seat: only B is told who the occupant is.
    const conflict = once(b.socket, "seat-update");
    b.socket.emit("seat-sit", { roomId: "4", seatId: 0 });
    expect(await conflict).toEqual({ roomId: "4", seatId: 0, playerId: a.init.selfId });
    await expectSilence(a.socket, "seat-update");

    const standSeenByB = once(b.socket, "seat-update");
    a.socket.emit("seat-stand");
    expect(await standSeenByB).toEqual({ roomId: "4", seatId: 0, playerId: null });
  });

  it("ignores seat-sit without room access", async () => {
    const a = await joinAs((await createPlayer("sna")).token);
    const b = await joinAs((await createPlayer("snb")).token);
    a.socket.emit("seat-sit", { roomId: "5", seatId: 0 });
    await expectSilence(b.socket, "seat-update");
  });
});

describe("room-leave", () => {
  it("detaches room chat, reverts scope to world, and revokes seat access", async () => {
    const a = await joinAs((await createPlayer("rla")).token);
    const b = await joinAs((await createPlayer("rlb")).token);

    for (const player of [a, b]) {
      const entered = once(player.socket, "room-enter-result");
      player.socket.emit("room-enter", { roomId: "5", key: process.env.ROOM_5_KEY });
      expect(await entered).toMatchObject({ ok: true, roomId: "5" });
    }

    const sat = onceMatching<{ seatId: number }>(b.socket, "seat-update", (payload) => payload.seatId === 1);
    a.socket.emit("seat-sit", { roomId: "5", seatId: 1 });
    expect(await sat).toEqual({ roomId: "5", seatId: 1, playerId: a.init.selfId });

    a.socket.emit("room-leave");
    await sleep(150); // async handler: channel leave + room-access revocation

    // B's room chat no longer reaches the leaver…
    const bEcho = once(b.socket, "chat");
    b.socket.emit("chat", { text: "still inside" });
    expect(await bEcho).toMatchObject({ text: "still inside", scope: "5" });
    await expectSilence(a.socket, "chat", 300, (payload) => payload.scope === "5");

    // …and the leaver's own chat reverts to world scope (B hears it as world).
    const worldChat = onceMatching<{ scope: string }>(b.socket, "chat", (payload) => payload.scope === "world");
    a.socket.emit("chat", { text: "back outside" });
    expect(await worldChat).toMatchObject({ id: a.init.selfId, text: "back outside", scope: "world" });

    // room-access is revoked: without re-entering, seat-sit is ignored.
    a.socket.emit("seat-sit", { roomId: "5", seatId: 2 });
    await expectSilence(b.socket, "seat-update", 300, (payload) => payload.seatId === 2);

    // room-leave alone does NOT free the seat — that is seat-stand's contract:
    // B contesting the seat is still told A occupies it…
    const conflict = onceMatching<{ seatId: number }>(b.socket, "seat-update", (payload) => payload.seatId === 1);
    b.socket.emit("seat-sit", { roomId: "5", seatId: 1 });
    expect(await conflict).toEqual({ roomId: "5", seatId: 1, playerId: a.init.selfId });

    // …and seat-stand still works after leaving (it needs no room access).
    const freed = onceMatching<{ playerId: string | null }>(
      b.socket,
      "seat-update",
      (payload) => payload.seatId === 1 && payload.playerId === null
    );
    a.socket.emit("seat-stand");
    expect(await freed).toEqual({ roomId: "5", seatId: 1, playerId: null });
  });
});

describe("disconnect grace", () => {
  it("suppresses player-left when the player returns within the grace window", async () => {
    const userA = await createPlayer("ga");
    const a = await joinAs(userA.token);
    const b = await joinAs((await createPlayer("gb")).token);

    a.socket.disconnect();
    // Rejoin as the same player before the grace timer fires.
    await sleep(Math.floor(LEAVE_GRACE_MS / 4));
    const again = await joinAs(userA.token);
    expect(again.init.selfId).toBe(a.init.selfId);
    // Filtered on A's id: earlier tests' disconnected players may still emit
    // their own player-left into the shared space during this window.
    await expectSilence(b.socket, "player-left", LEAVE_GRACE_MS * 2, (payload) => payload.id === a.init.selfId);
  });

  it("broadcasts player-left once the grace window lapses", async () => {
    const userA = await createPlayer("gla");
    const a = await joinAs(userA.token);
    const b = await joinAs((await createPlayer("glb")).token);

    const left = onceMatching<{ id: string }>(
      b.socket,
      "player-left",
      (payload) => payload.id === a.init.selfId,
      LEAVE_GRACE_MS * 6
    );
    a.socket.disconnect();
    expect((await left).id).toBe(a.init.selfId);
  });

  it("frees the player's seat when they are gone for good", async () => {
    const userA = await createPlayer("gsa");
    const a = await joinAs(userA.token);
    const b = await joinAs((await createPlayer("gsb")).token);

    const entered = once(a.socket, "room-enter-result");
    a.socket.emit("room-enter", { roomId: "6", key: process.env.ROOM_6_KEY });
    expect(await entered).toMatchObject({ ok: true });

    const sat = once(b.socket, "seat-update");
    a.socket.emit("seat-sit", { roomId: "6", seatId: 1 });
    expect(await sat).toEqual({ roomId: "6", seatId: 1, playerId: a.init.selfId });

    const freed = onceMatching<{ roomId: string; seatId: number; playerId: string | null }>(
      b.socket,
      "seat-update",
      (payload) => payload.roomId === "6" && payload.seatId === 1,
      LEAVE_GRACE_MS * 6
    );
    a.socket.disconnect();
    expect(await freed).toEqual({ roomId: "6", seatId: 1, playerId: null });
  });
});
