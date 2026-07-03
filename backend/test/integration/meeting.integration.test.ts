/**
 * Meeting lifecycle at the socket seam (PRD 10): the server derives the
 * all-seated trigger from real seat + room state and broadcasts the
 * meeting-lifecycle events room-scoped. The trigger rules themselves are
 * exhaustively unit-tested in test/meeting.test.ts; these tests prove the
 * wiring — real sockets, real Redis seats, real countdown timer
 * (MEETING_COUNTDOWN_MS is shrunk to 300ms by setup.ts).
 */
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createPlayer,
  expectSilence,
  once,
  onceMatching,
  sleep,
  startServer,
  teardown,
  type TestServer,
} from "./helpers.js";

const COUNTDOWN_MS = Number(process.env.MEETING_COUNTDOWN_MS);
const LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS);

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

interface Player {
  socket: ClientSocket;
  selfId: string;
}

async function playerInRoom(prefix: string, roomId: string, key: string): Promise<Player> {
  const user = await createPlayer(prefix);
  const { socket, selfId } = await joinAs(user.token);
  const entered = once<{ ok: boolean }>(socket, "room-enter-result");
  socket.emit("room-enter", { roomId, key });
  expect((await entered).ok).toBe(true);
  return { socket, selfId };
}

function sit(player: Player, roomId: string, seatId: number): Promise<unknown> {
  const confirmed = onceMatching<{ seatId: number; playerId: string | null }>(
    player.socket,
    "seat-update",
    (seat) => seat.seatId === seatId && seat.playerId === player.selfId,
  );
  player.socket.emit("seat-sit", { roomId, seatId });
  return confirmed;
}

beforeAll(async () => {
  server = await startServer();
  base = server.baseUrl;
});

afterEach(async () => {
  for (const socket of liveSockets.splice(0)) socket.disconnect();
  // Let grace timers from this test's players expire so their delayed
  // stand/leave dispatches cannot broadcast into the next test's room.
  await sleep(LEAVE_GRACE_MS + 200);
});

afterAll(async () => {
  await teardown(server);
});

describe("meeting trigger", () => {
  it("a solo sitter starts no countdown", async () => {
    const a = await playerInRoom("ms", "1", process.env.ROOM_1_KEY ?? "1234");
    await sit(a, "1", 0);
    await expectSilence(a.socket, "meeting-countdown");
  });

  it("all seated (2 players) starts a countdown for both, then the meeting", async () => {
    const a = await playerInRoom("m2a", "1", process.env.ROOM_1_KEY ?? "1234");
    const b = await playerInRoom("m2b", "1", process.env.ROOM_1_KEY ?? "1234");

    await sit(a, "1", 0);
    const countdownA = once<{ roomId: string; durationMs: number; participants: { id: string; name: string }[] }>(
      a.socket,
      "meeting-countdown",
    );
    const countdownB = once(b.socket, "meeting-countdown");
    const startedA = once<{ roomId: string; participants: { id: string }[] }>(a.socket, "meeting-started");
    const startedB = once<{ roomId: string; participants: { id: string }[] }>(b.socket, "meeting-started");
    await sit(b, "1", 1);

    const countdown = await countdownA;
    await countdownB;
    expect(countdown.roomId).toBe("1");
    expect(countdown.durationMs).toBe(COUNTDOWN_MS);
    expect(countdown.participants.map((participant) => participant.id).sort()).toEqual(
      [a.selfId, b.selfId].sort(),
    );

    const started = await startedA;
    await startedB;
    expect(started.participants.map((participant) => participant.id).sort()).toEqual([a.selfId, b.selfId].sort());
  });

  it("meeting events are room-scoped: a player outside the room hears nothing", async () => {
    const outsider = await createPlayer("mout");
    const { socket: outsiderSocket } = await joinAs(outsider.token);
    const a = await playerInRoom("mra", "2", process.env.ROOM_2_KEY ?? "4321");
    const b = await playerInRoom("mrb", "2", process.env.ROOM_2_KEY ?? "4321");

    await sit(a, "2", 0);
    const started = once(a.socket, "meeting-started");
    await sit(b, "2", 1);
    await started;
    await expectSilence(outsiderSocket, "meeting-countdown");
    await expectSilence(outsiderSocket, "meeting-started");
  });

  it("standing during the countdown cancels it and no meeting starts", async () => {
    const a = await playerInRoom("mca", "3", process.env.ROOM_3_KEY ?? "3333");
    const b = await playerInRoom("mcb", "3", process.env.ROOM_3_KEY ?? "3333");

    await sit(a, "3", 0);
    const countdown = once(b.socket, "meeting-countdown");
    await sit(b, "3", 1);
    await countdown;

    const canceledA = once<{ roomId: string; reason: string }>(a.socket, "meeting-countdown-canceled");
    b.socket.emit("seat-stand");
    expect((await canceledA).reason).toBe("stand");
    // The canceled countdown's timer must never fire.
    await expectSilence(a.socket, "meeting-started", COUNTDOWN_MS + 300);
  });

  it("an unseated entry cancels the countdown; it re-arms when the entrant sits", async () => {
    const a = await playerInRoom("mea", "4", process.env.ROOM_4_KEY ?? "4444");
    const b = await playerInRoom("meb", "4", process.env.ROOM_4_KEY ?? "4444");
    // Pre-connect the entrant: only the (fast) room-enter round trip may sit
    // between the countdown arming and the cancellation, or the 300ms
    // countdown could elapse first and flake the test.
    const userC = await createPlayer("mec");
    const c: Player = await joinAs(userC.token);

    await sit(a, "4", 0);
    const countdown = once(a.socket, "meeting-countdown");
    await sit(b, "4", 1);
    await countdown;

    const canceled = once<{ reason: string }>(a.socket, "meeting-countdown-canceled");
    const entered = once<{ ok: boolean }>(c.socket, "room-enter-result");
    c.socket.emit("room-enter", { roomId: "4", key: process.env.ROOM_4_KEY ?? "4444" });
    expect((await entered).ok).toBe(true);
    expect((await canceled).reason).toBe("unseated-entry");

    const rearmed = once<{ participants: { id: string }[] }>(a.socket, "meeting-countdown");
    const started = once<{ participants: { id: string }[] }>(c.socket, "meeting-started");
    await sit(c, "4", 2);
    expect((await rearmed).participants).toHaveLength(3);
    expect((await started).participants.map((participant) => participant.id).sort()).toEqual(
      [a.selfId, b.selfId, c.selfId].sort(),
    );
  });

  it("a latecomer who sits mid-meeting joins in place with the full roster", async () => {
    const a = await playerInRoom("mla", "5", process.env.ROOM_5_KEY ?? "5555");
    const b = await playerInRoom("mlb", "5", process.env.ROOM_5_KEY ?? "5555");

    await sit(a, "5", 0);
    const started = once(a.socket, "meeting-started");
    await sit(b, "5", 1);
    await started;

    // Entering an active meeting room unseated cancels nothing (no countdown
    // is pending) and does not disturb the meeting.
    const c = await playerInRoom("mlc", "5", process.env.ROOM_5_KEY ?? "5555");
    await expectSilence(a.socket, "meeting-ended");

    const joinedSeenByA = once<{
      participant: { id: string; name: string };
      participants: { id: string }[];
    }>(a.socket, "meeting-participant-joined");
    const joinedSeenByC = once<{ participant: { id: string }; participants: { id: string }[] }>(
      c.socket,
      "meeting-participant-joined",
    );
    await sit(c, "5", 2);

    const joined = await joinedSeenByA;
    expect(joined.participant.id).toBe(c.selfId);
    expect(joined.participants.map((participant) => participant.id).sort()).toEqual(
      [a.selfId, b.selfId, c.selfId].sort(),
    );
    // The latecomer's own client gets the same roster (it never saw meeting-started).
    expect((await joinedSeenByC).participants).toHaveLength(3);
  });

  it("a participant standing leaves alone; the last leaver ends the meeting", async () => {
    const a = await playerInRoom("mfa", "6", process.env.ROOM_6_KEY ?? "6666");
    const b = await playerInRoom("mfb", "6", process.env.ROOM_6_KEY ?? "6666");

    await sit(a, "6", 0);
    const started = once(a.socket, "meeting-started");
    await sit(b, "6", 1);
    await started;

    const leftSeenByA = once<{ playerId: string }>(a.socket, "meeting-participant-left");
    b.socket.emit("seat-stand");
    expect((await leftSeenByA).playerId).toBe(b.selfId);
    // One participant remains: the meeting continues (no auto-end at 1).
    await expectSilence(a.socket, "meeting-ended");

    const ended = once<{ roomId: string }>(a.socket, "meeting-ended");
    const lastLeft = once<{ playerId: string }>(a.socket, "meeting-participant-left");
    a.socket.emit("seat-stand");
    expect((await lastLeft).playerId).toBe(a.selfId);
    expect((await ended).roomId).toBe("6");
  });

  it("a disconnected participant leaves the meeting only after the grace window", async () => {
    const a = await playerInRoom("mga", "1", process.env.ROOM_1_KEY ?? "1234");
    const b = await playerInRoom("mgb", "1", process.env.ROOM_1_KEY ?? "1234");

    await sit(a, "1", 0);
    const started = once(a.socket, "meeting-started");
    await sit(b, "1", 1);
    await started;

    b.socket.disconnect();
    // Within grace the seat is held: no participant-left yet.
    await expectSilence(a.socket, "meeting-participant-left", Math.floor(LEAVE_GRACE_MS / 2));
    const left = await onceMatching<{ playerId: string }>(
      a.socket,
      "meeting-participant-left",
      (payload) => payload.playerId === b.selfId,
      LEAVE_GRACE_MS + 2_000,
    );
    expect(left.playerId).toBe(b.selfId);
    const ended = once(a.socket, "meeting-ended");
    a.socket.emit("seat-stand");
    await ended;
  });
});
