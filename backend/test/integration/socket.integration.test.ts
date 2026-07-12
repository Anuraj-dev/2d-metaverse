import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { redis } from "../../src/redis.js";
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

function connectRecoverable(token: string): ClientSocket {
  const socket = io(base, {
    transports: ["websocket"],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 10,
    reconnectionDelayMax: 10,
  });
  liveSockets.push(socket);
  return socket;
}

async function recoverTransport(socket: ClientSocket): Promise<{ selfId: string; players: Array<{ id: string; name: string; x: number; y: number; dir: string }> }> {
  const init = once<{ selfId: string; players: Array<{ id: string; name: string; x: number; y: number; dir: string }> }>(
    socket,
    "init",
    LEAVE_GRACE_MS * 6,
  );
  const recovered = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket did not recover")), LEAVE_GRACE_MS * 6);
    socket.once("disconnect", () => {
      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  });
  socket.io.engine.close();
  await recovered;
  expect(socket.recovered).toBe(true);
  return init;
}

/** Connect and join space 1, returning the socket and the init payload. */
async function joinAs(token: string) {
  const socket = connect(token);
  await once(socket, "connect");
  const init = once<{ selfId: string; players: Array<{ id: string }> }>(socket, "init");
  socket.emit("join", { spaceId: "1" });
  return { socket, init: await init };
}

type Joined = Awaited<ReturnType<typeof joinAs>>;

/** The first player to knock at an empty room walks straight in as its admin. */
async function enterAsAdmin(player: Joined, roomId: string): Promise<void> {
  const approved = once(player.socket, "knock-result");
  player.socket.emit("knock", { roomId });
  expect(await approved).toEqual({ roomId, result: "approved" });
}

/** A later arrival knocks; the room's admin approves them in. */
async function knockAndApprove(roomId: string, admin: Joined, knocker: Joined): Promise<void> {
  const pending = onceMatching<{ knocks: Array<{ id: string }> }>(
    admin.socket,
    "knock-pending",
    (payload) => payload.knocks.some((k) => k.id === knocker.init.selfId),
  );
  const approved = once(knocker.socket, "knock-result");
  knocker.socket.emit("knock", { roomId });
  await pending;
  admin.socket.emit("approve-knock", { roomId, playerId: knocker.init.selfId });
  expect(await approved).toEqual({ roomId, result: "approved" });
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
  it("places a fresh non-recovered join at the documented spawn", async () => {
    const user = await createPlayer("jsp");
    const joined = await joinAs(user.token);
    expect(joined.init.players).toContainEqual({
      id: joined.init.selfId,
      name: user.username,
      x: 960,
      y: 704,
      dir: "down",
    });
  });

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

describe("movement", () => {
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
});

describe("movement envelope (PRD 25.21)", () => {
  // Spawn is (960, 704) per the geometry manifest; the first move after join
  // re-anchors the envelope, so a second honest step is the real envelope check.
  it("accepts an honest walk sequence", async () => {
    const a = await joinAs((await createPlayer("mea")).token);
    const b = await joinAs((await createPlayer("meb")).token);

    const anchored = once(b.socket, "player-moved");
    a.socket.emit("move", { x: 970, y: 704, dir: "right" }); // re-anchors from spawn
    await anchored;
    await sleep(60); // clear the moveThrottleMs window

    const stepped = once(b.socket, "player-moved");
    a.socket.emit("move", { x: 984, y: 704, dir: "right" }); // small honest step
    expect(await stepped).toEqual({ id: a.init.selfId, x: 984, y: 704, dir: "right" });
  });

  it("corrects an impossible teleport, keeps the last accepted position, and does not broadcast it", async () => {
    const a = await joinAs((await createPlayer("met")).token);
    const b = await joinAs((await createPlayer("meu")).token);

    const anchored = once(b.socket, "player-moved");
    a.socket.emit("move", { x: 970, y: 710, dir: "down" }); // re-anchors
    await anchored;
    await sleep(60);

    const corrected = once<{ x: number; y: number; dir: string; reason: string }>(
      a.socket,
      "move-correction",
    );
    a.socket.emit("move", { x: 1900, y: 1800, dir: "down" }); // cross-map jump
    expect(await corrected).toEqual({ x: 970, y: 710, dir: "down", reason: "too-fast" });

    // Peer never saw the rejected position, and presence keeps the last accepted.
    await expectSilence(b.socket, "player-moved");
    const raw = await redis.hGet("presence:1", a.init.selfId);
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ x: 970, y: 710 });
  });

  it("corrects an out-of-bounds move back to the last accepted position", async () => {
    const a = await joinAs((await createPlayer("meo")).token);
    const corrected = once<{ reason: string }>(a.socket, "move-correction");
    // Passes the zod coordinate ceiling but lies outside the campus world rect.
    a.socket.emit("move", { x: 99999, y: 10, dir: "right" });
    expect(await corrected).toMatchObject({ reason: "out-of-bounds" });
  });

  it("accepts a manifest-declared portal jump as a legal discontinuity", async () => {
    const a = await joinAs((await createPlayer("mep")).token);
    const b = await joinAs((await createPlayer("meq")).token);

    // Stand inside the portal's interact rect (432,688,32,32) — re-anchors there.
    const anchored = once(b.socket, "player-moved");
    a.socket.emit("move", { x: 448, y: 704, dir: "up" });
    await anchored;
    await sleep(60);

    // Teleport to the portal's declared target (1280,688): a huge delta, but legal.
    const jumped = once(b.socket, "player-moved");
    a.socket.emit("move", { x: 1280, y: 688, dir: "up" });
    expect(await jumped).toEqual({ id: a.init.selfId, x: 1280, y: 688, dir: "up" });
  });
});

describe("chat", () => {
  it("delivers world chat to the whole space", async () => {
    const a = await joinAs((await createPlayer("ca")).token);
    const b = await joinAs((await createPlayer("cb")).token);
    const seen = once(b.socket, "chat");
    a.socket.emit("chat", { text: "hello world" });
    expect(await seen).toMatchObject({ id: a.init.selfId, text: "hello world", scope: "world" });
  });

  it("refuses the 11th world chat line in the window with a typed cooldown (not a silent drop)", async () => {
    const a = await joinAs((await createPlayer("cra")).token);
    const b = await joinAs((await createPlayer("crb")).token);

    // The shared world/room chat window is 10 per player; the 11th is refused.
    for (let index = 0; index < 10; index += 1) {
      const seen = once(b.socket, "chat");
      a.socket.emit("chat", { text: `line ${index}` });
      await seen;
    }
    const cooled = once<{ scope: string; retryAfterMs: number }>(a.socket, "chat-cooldown");
    a.socket.emit("chat", { text: "one too many" });
    const payload = await cooled;
    expect(payload.scope).toBe("world");
    expect(payload.retryAfterMs).toBeGreaterThan(0);
    // The refused line never reaches other players.
    await expectSilence(b.socket, "chat", 50);
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

  it("refuses the 21st whisper in the window with a typed cooldown (not a silent drop)", async () => {
    const a = await joinAs((await createPlayer("wra")).token);
    const b = await joinAs((await createPlayer("wrb")).token);

    for (let index = 0; index < 20; index += 1) {
      const echoed = once(a.socket, "whisper");
      a.socket.emit("whisper", { to: b.init.selfId, text: `msg ${index}` });
      await echoed;
    }
    const cooled = once<{ scope: string; retryAfterMs: number }>(a.socket, "chat-cooldown");
    a.socket.emit("whisper", { to: b.init.selfId, text: "one too many" });
    const payload = await cooled;
    expect(payload.scope).toBe("whisper");
    expect(payload.retryAfterMs).toBeGreaterThan(0);
    // The refused whisper is neither delivered nor echoed.
    await expectSilence(a.socket, "whisper");
    await expectSilence(b.socket, "whisper", 50);
  });
});

describe("room access — knock/approve (PRD 14)", () => {
  it("admits the first knocker as admin, then a knocker the admin approves", async () => {
    const admin = await joinAs((await createPlayer("rka")).token);
    const guest = await joinAs((await createPlayer("rkg")).token);

    // Empty room: the admin walks straight in and is announced as admin.
    const adminAnnounced = once<{ admin: { id: string } | null; reason: string }>(admin.socket, "admin-changed");
    await enterAsAdmin(admin, "1");
    expect(await adminAnnounced).toMatchObject({ admin: { id: admin.init.selfId }, reason: "initial" });

    // A later arrival is queued until approved.
    const pending = onceMatching<{ knocks: Array<{ id: string }> }>(
      admin.socket,
      "knock-pending",
      (payload) => payload.knocks.some((k) => k.id === guest.init.selfId),
    );
    const approved = once(guest.socket, "knock-result");
    guest.socket.emit("knock", { roomId: "1" });
    await pending;
    admin.socket.emit("approve-knock", { roomId: "1", playerId: guest.init.selfId });
    expect(await approved).toEqual({ roomId: "1", result: "approved" });
  });

  it("times out an unanswered knock as denied", async () => {
    const admin = await joinAs((await createPlayer("rta")).token);
    const guest = await joinAs((await createPlayer("rtg")).token);
    await enterAsAdmin(admin, "2");

    // KNOCK_TIMEOUT_MS is shrunk to 300ms in setup.ts — no admin action.
    const result = once<{ result: string }>(guest.socket, "knock-result", 3_000);
    guest.socket.emit("knock", { roomId: "2" });
    expect(await result).toEqual({ roomId: "2", result: "timeout" });
  });

  it("scopes room chat to room members only", async () => {
    const admin = await joinAs((await createPlayer("rca")).token);
    const b = await joinAs((await createPlayer("rcb")).token);

    await enterAsAdmin(admin, "3");

    const ownEcho = once(admin.socket, "chat");
    admin.socket.emit("chat", { text: "room secret" });
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

    await enterAsAdmin(a, "4");
    await knockAndApprove("4", a, b);

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

    await enterAsAdmin(a, "5");
    await knockAndApprove("5", a, b);

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
  it("preserves the last authoritative position through real socket recovery", async () => {
    const user = await createPlayer("grp");
    const socket = connectRecoverable(user.token);
    await once(socket, "connect");
    const init = once<{ selfId: string }>(socket, "init");
    socket.emit("join", { spaceId: "1" });
    const { selfId } = await init;

    const peer = await joinAs((await createPlayer("grpp")).token);
    const moved = onceMatching<{ id: string }>(peer.socket, "player-moved", (payload) => payload.id === selfId);
    socket.emit("move", { x: 321, y: 288, dir: "right" });
    await moved;

    const recovered = await recoverTransport(socket);
    expect(recovered.players).toContainEqual({ id: selfId, name: user.username, x: 321, y: 288, dir: "right" });
    await expectSilence(
      peer.socket,
      "player-left",
      LEAVE_GRACE_MS * 2,
      (payload) => payload.id === selfId,
    );

    const observer = await joinAs((await createPlayer("grpo")).token);
    expect(observer.init.players).toContainEqual({ id: selfId, name: user.username, x: 321, y: 288, dir: "right" });
  });

  it("replaces invalid recovered presence with the documented spawn", async () => {
    const user = await createPlayer("gri");
    const socket = connectRecoverable(user.token);
    await once(socket, "connect");
    const initial = once<{ selfId: string }>(socket, "init");
    socket.emit("join", { spaceId: "1" });
    const { selfId } = await initial;

    await redis.hSet(`presence:1`, selfId, JSON.stringify({
      id: selfId,
      name: user.username,
      x: -1,
      y: 288,
      dir: "right",
      connectionId: socket.id,
    }));

    const recovered = await recoverTransport(socket);
    expect(recovered.players).toContainEqual({ id: selfId, name: user.username, x: 960, y: 704, dir: "down" });

    const observer = await joinAs((await createPlayer("grio")).token);
    expect(observer.init.players).toContainEqual({ id: selfId, name: user.username, x: 960, y: 704, dir: "down" });
  });

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

    await enterAsAdmin(a, "6");

    // Match this room+seat specifically: a prior test's grace-delayed seat free
    // can still be broadcasting a null seat-update into the shared space.
    const sat = onceMatching<{ roomId: string; seatId: number; playerId: string | null }>(
      b.socket,
      "seat-update",
      (payload) => payload.roomId === "6" && payload.seatId === 1 && payload.playerId === a.init.selfId,
    );
    a.socket.emit("seat-sit", { roomId: "6", seatId: 1 });
    expect(await sat).toEqual({ roomId: "6", seatId: 1, playerId: a.init.selfId });

    // Wait for the FREE (null) specifically: on a slow runner a's own sit
    // broadcast can still be in flight when this listener registers.
    const freed = onceMatching<{ roomId: string; seatId: number; playerId: string | null }>(
      b.socket,
      "seat-update",
      (payload) => payload.roomId === "6" && payload.seatId === 1 && payload.playerId === null,
      LEAVE_GRACE_MS * 6
    );
    a.socket.disconnect();
    expect(await freed).toEqual({ roomId: "6", seatId: 1, playerId: null });
  });
});
