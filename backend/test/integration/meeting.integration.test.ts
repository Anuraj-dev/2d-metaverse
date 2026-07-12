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
  walkToDoor,
  walkToSeat,
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

/** Walk to the door, knock, and wait to be admitted (used once allow-all is
 *  open, or as the first-in admin). PRD 25.23 requires door proximity to knock. */
async function knockInto(socket: ClientSocket, roomId: string): Promise<void> {
  const approved = once<{ result: string }>(socket, "knock-result");
  walkToDoor(socket, roomId);
  socket.emit("knock", { roomId });
  expect((await approved).result).toBe("approved");
}

/**
 * The first player into a room becomes its admin (PRD 14); it then opens the
 * door (allow-all) so co-tenants can walk straight in. These meeting tests only
 * need players co-located — knock/approve gating is covered in
 * socket.integration.test.ts.
 */
async function adminInRoom(prefix: string, roomId: string): Promise<Player> {
  const user = await createPlayer(prefix);
  const { socket, selfId } = await joinAs(user.token);
  await knockInto(socket, roomId);
  const opened = onceMatching<{ roomId: string; allowAll: boolean }>(
    socket,
    "room-open-state",
    (payload) => payload.roomId === roomId && payload.allowAll,
  );
  socket.emit("toggle-allow-all", { roomId, allowAll: true });
  await opened;
  return { socket, selfId };
}

/** A co-tenant entering a room already opened by its admin (auto-admitted). */
async function joinOpenRoom(prefix: string, roomId: string): Promise<Player> {
  const user = await createPlayer(prefix);
  const { socket, selfId } = await joinAs(user.token);
  await knockInto(socket, roomId);
  return { socket, selfId };
}

async function sit(player: Player, roomId: string, seatId: number): Promise<unknown> {
  const confirmed = onceMatching<{ seatId: number; playerId: string | null }>(
    player.socket,
    "seat-update",
    (seat) => seat.seatId === seatId && seat.playerId === player.selfId,
  );
  // PRD 25.23: walk onto the seat (in-room + proximity) before sitting.
  await walkToSeat(player.socket, roomId, seatId);
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
    const a = await adminInRoom("ms", "1");
    await sit(a, "1", 0);
    await expectSilence(a.socket, "meeting-countdown");
  });

  it("all seated (2 players) starts a countdown for both, then the meeting", async () => {
    const a = await adminInRoom("m2a", "1");
    const b = await joinOpenRoom("m2b", "1");

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
    const a = await adminInRoom("mra", "2");
    const b = await joinOpenRoom("mrb", "2");

    await sit(a, "2", 0);
    const started = once(a.socket, "meeting-started");
    await sit(b, "2", 1);
    await started;
    await expectSilence(outsiderSocket, "meeting-countdown");
    await expectSilence(outsiderSocket, "meeting-started");
  });

  it("standing during the countdown cancels it and no meeting starts", async () => {
    const a = await adminInRoom("mca", "3");
    const b = await joinOpenRoom("mcb", "3");

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
    const a = await adminInRoom("mea", "4");
    const b = await joinOpenRoom("meb", "4");
    // Pre-connect the entrant: only the (fast) knock round trip may sit
    // between the countdown arming and the cancellation, or the 300ms
    // countdown could elapse first and flake the test.
    const userC = await createPlayer("mec");
    const c: Player = await joinAs(userC.token);

    await sit(a, "4", 0);
    const countdown = once(a.socket, "meeting-countdown");
    await sit(b, "4", 1);
    await countdown;

    const canceled = once<{ reason: string }>(a.socket, "meeting-countdown-canceled");
    // Room 4 is open (allow-all): c's knock auto-admits, an unseated entry.
    await knockInto(c.socket, "4");
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
    const a = await adminInRoom("mla", "5");
    const b = await joinOpenRoom("mlb", "5");

    await sit(a, "5", 0);
    const started = once(a.socket, "meeting-started");
    await sit(b, "5", 1);
    await started;

    // Entering an active meeting room unseated cancels nothing (no countdown
    // is pending) and does not disturb the meeting.
    const c = await joinOpenRoom("mlc", "5");
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
    const a = await adminInRoom("mfa", "6");
    const b = await joinOpenRoom("mfb", "6");

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
    const a = await adminInRoom("mga", "1");
    const b = await joinOpenRoom("mgb", "1");

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

describe("meeting chat anti-spam (PRD 25.11)", () => {
  it("refuses the 21st meeting-chat line in the window with a typed cooldown", async () => {
    // The cooldown is enforced on the meeting-chat send regardless of whether a
    // live meeting exists — being in a room is enough to type; the limiter guards
    // the send itself. The window is 20 per player, so the 21st is refused.
    const a = await adminInRoom("spamc", "1");
    for (let index = 0; index < 20; index += 1) {
      a.socket.emit("meeting-chat", { text: `spam ${index}` });
    }
    const cooled = once<{ scope: string; retryAfterMs: number }>(a.socket, "chat-cooldown");
    a.socket.emit("meeting-chat", { text: "one too many" });
    const payload = await cooled;
    expect(payload.scope).toBe("meeting");
    expect(payload.retryAfterMs).toBeGreaterThan(0);
  });
});
