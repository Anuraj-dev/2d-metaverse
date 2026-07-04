import assert from "node:assert/strict";
import { io } from "socket.io-client";

const baseUrl = process.env.SMOKE_URL ?? "http://localhost:3001";
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function api(path, { token, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, json };
}

function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timeout); resolve(payload); });
  });
}

async function createUser(username) {
  const password = "testing-password-123";
  assert.equal((await api("/api/v1/signup", { body: { username, password } })).status, 200);
  const signin = await api("/api/v1/signin", { body: { username, password } });
  assert.equal(signin.status, 200);
  assert.equal(typeof signin.json.token, "string");
  return signin.json.token;
}

const tokenA = await createUser(`smokea_${suffix}`);
const tokenB = await createUser(`smokeb_${suffix}`);

const space = await api("/api/v1/space/1", { token: tokenA });
assert.equal(space.status, 200);
assert.equal(space.json.rooms.length, 6);
const room3 = space.json.rooms.find((room) => room.id === "3");
assert.equal(room3?.seats.length, 12);

const worldToken = await api("/api/v1/livekit/token", { token: tokenA, body: { roomName: "world:1" } });
assert.equal(worldToken.status, 200);
assert.equal(typeof worldToken.json.livekitToken, "string");
assert.equal((await api("/api/v1/livekit/token", { token: tokenA, body: { roomName: "room:1" } })).status, 403);

const rejectedSocket = io(baseUrl, { transports: ["websocket"], auth: { token: "invalid" } });
try {
  const rejected = await once(rejectedSocket, "connect_error");
  assert.equal(rejected.message, "unauthorized");
} finally {
  rejectedSocket.disconnect();
}

const socketA = io(baseUrl, { transports: ["websocket"], auth: { token: tokenA } });
const socketB = io(baseUrl, { transports: ["websocket"], auth: { token: tokenB } });
const occupiedSeats = new Set();
const trackSeat = ({ roomId, seatId, playerId }) => {
  const key = `${roomId}:${seatId}`;
  if (playerId) occupiedSeats.add(key);
  else occupiedSeats.delete(key);
};
socketA.on("seat-update", trackSeat);
try {
  await Promise.all([once(socketA, "connect"), once(socketB, "connect")]);
  const initA = once(socketA, "init");
  socketA.emit("join", { spaceId: "1" });
  const a = await initA;
  assert.ok(a.players.some((player) => player.id === a.selfId));

  const initB = once(socketB, "init");
  socketB.emit("join", { spaceId: "1" });
  const b = await initB;
  assert.ok(b.players.some((player) => player.id === a.selfId));

  await new Promise((resolve) => setTimeout(resolve, 100));
  const selected = room3.seats
    .map((seat) => ({ roomId: room3.id, seatId: seat.id }))
    .find(({ roomId, seatId }) => !occupiedSeats.has(`${roomId}:${seatId}`));
  assert.ok(selected, "No free seat available for smoke test");
  const roomKey = "3333";

  const badEntry = once(socketA, "room-enter-result");
  socketA.emit("room-enter", { roomId: selected.roomId, key: "wrong" });
  assert.deepEqual(await badEntry, { ok: false, roomId: selected.roomId, reason: "bad-key" });

  const goodEntry = once(socketA, "room-enter-result");
  socketA.emit("room-enter", { roomId: selected.roomId, key: roomKey });
  assert.deepEqual(await goodEntry, { ok: true, roomId: selected.roomId });

  let chatLeakedToWorld = false;
  socketB.once("chat", () => { chatLeakedToWorld = true; });
  const privateChat = once(socketA, "chat");
  socketA.emit("chat", { text: "private smoke test" });
  assert.deepEqual(await privateChat, { id: a.selfId, name: `smokea_${suffix}`, text: "private smoke test", scope: selected.roomId });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(chatLeakedToWorld, false, "private chat leaked to a world participant");

  const entryB = once(socketB, "room-enter-result");
  socketB.emit("room-enter", { roomId: selected.roomId, key: roomKey });
  assert.deepEqual(await entryB, { ok: true, roomId: selected.roomId });
  const privateChatSeenByB = once(socketB, "chat");
  socketA.emit("chat", { text: "room peer smoke test" });
  assert.deepEqual(await privateChatSeenByB, { id: a.selfId, name: `smokea_${suffix}`, text: "room peer smoke test", scope: selected.roomId });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rejectedEntry = once(socketA, "room-enter-result");
    socketA.emit("room-enter", { roomId: selected.roomId, key: "wrong" });
    assert.deepEqual(await rejectedEntry, { ok: false, roomId: selected.roomId, reason: "bad-key" });
  }
  const rateLimitedEntry = once(socketA, "room-enter-result");
  socketA.emit("room-enter", { roomId: selected.roomId, key: "wrong" });
  assert.deepEqual(await rateLimitedEntry, { ok: false, roomId: selected.roomId, reason: "rate-limited" });

  const seatSeenByB = once(socketB, "seat-update");
  socketA.emit("seat-sit", selected);
  assert.deepEqual(await seatSeenByB, { ...selected, playerId: a.selfId });

  const privateToken = await api("/api/v1/livekit/token", { token: tokenA, body: { roomName: `room:${selected.roomId}` } });
  assert.equal(privateToken.status, 200);

  const moveSeen = once(socketB, "player-moved");
  socketA.emit("move", { x: 321, y: 288, dir: "right" });
  assert.deepEqual(await moveSeen, { id: a.selfId, x: 321, y: 288, dir: "right" });

  const chatSeen = once(socketB, "chat");
  socketA.emit("chat", { text: "smoke test" });
  assert.equal((await chatSeen).scope, selected.roomId);

  const standSeen = once(socketB, "seat-update");
  socketA.emit("seat-stand");
  assert.deepEqual(await standSeen, { ...selected, playerId: null });
  assert.equal((await api("/api/v1/livekit/token", { token: tokenA, body: { roomName: `room:${selected.roomId}` } })).status, 403);

  // stage token: audience (no presenterKey) → 200
  const stageAudience = await api("/api/v1/livekit/token", { token: tokenA, body: { roomName: "stage:1" } });
  assert.equal(stageAudience.status, 200);
  assert.equal(typeof stageAudience.json.livekitToken, "string");

  // stage token: bad presenterKey → 403
  const stageBadKey = await api("/api/v1/livekit/token", { token: tokenA, body: { roomName: "stage:1", presenterKey: "wrong-key" } });
  assert.equal(stageBadKey.status, 403);
  assert.equal(stageBadKey.json.error, "bad-presenter-key");
} finally {
  socketA.disconnect();
  socketB.disconnect();
}

console.log("Backend smoke test passed");
