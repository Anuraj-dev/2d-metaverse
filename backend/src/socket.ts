import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { verifyToken } from "./auth.js";
import { config } from "./config.js";
import { childLogger } from "./logger.js";
import { getRoom, getSeatIds, getSpace, seatExists, spaceExists } from "./repository.js";
import { isRateLimitExceeded, redis } from "./redis.js";
import { sitPlayer, standPlayer } from "./seat-store.js";
import type { SeatRef } from "./seat-key.js";
import { verifySecret } from "./password.js";
import { removeMediaParticipant } from "./media.js";
import type { ClientToServerEvents, PlayerState, ServerToClientEvents, SocketData } from "./types.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const socketAuthSchema = z.object({ token: z.string().min(1) });
const joinSchema = z.object({ spaceId: z.string().min(1).max(64) });
const moveSchema = z.object({
  x: z.number().finite().min(0).max(100_000),
  y: z.number().finite().min(0).max(100_000),
  dir: z.enum(["down", "left", "right", "up"])
});
const chatSchema = z.object({
  text: z.string().trim().min(1).max(500),
  scope: z.enum(["world", "room"]).optional()
});
const whisperSchema = z.object({ to: z.string().min(1).max(64), text: z.string().trim().min(1).max(500) });
const WHISPER_LIMIT = 20;
const WHISPER_WINDOW_SECONDS = 60;
const roomEnterSchema = z.object({ roomId: z.string().min(1).max(64), key: z.string().min(1).max(128) });
const seatSitSchema = z.object({ roomId: z.string().min(1).max(64), seatId: z.number().int().nonnegative() });
// Env-overridable so integration tests can shrink these and exercise the
// timeout/grace paths in milliseconds. Defaults (used outside tests) unchanged.
const LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS ?? 4_000);
const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS ?? 10_000);
const ROOM_KEY_ATTEMPT_LIMIT = 5;
const ROOM_KEY_ATTEMPT_WINDOW_SECONDS = 5 * 60;

const spaceChannel = (spaceId: string) => `space:${spaceId}`;
const roomChannel = (roomId: string) => `room:${roomId}`;
const pendingLeaves = new Map<string, NodeJS.Timeout>();
const activeSockets = new Map<string, GameSocket>();

async function presenceFor(spaceId: string): Promise<PlayerState[]> {
  const values = await redis.hVals(`presence:${spaceId}`);
  return values.flatMap((value) => {
    try {
      const parsed = JSON.parse(value) as PlayerState & { connectionId: string };
      return [{ id: parsed.id, name: parsed.name, x: parsed.x, y: parsed.y, dir: parsed.dir }];
    } catch {
      return [];
    }
  });
}

async function emitOccupiedSeats(socket: GameSocket, roomId: string): Promise<void> {
  const seatIds = await getSeatIds(roomId);
  if (seatIds.length === 0) return;
  const occupants = await redis.mGet(seatIds.map((seatId) => `seat:${roomId}:${seatId}`));
  occupants.forEach((playerId, index) => {
    const seatId = seatIds[index];
    if (playerId && seatId !== undefined) socket.emit("seat-update", { roomId, seatId, playerId });
  });
}

async function occupiedCount(roomId: string): Promise<number> {
  const seatIds = await getSeatIds(roomId);
  if (seatIds.length === 0) return 0;
  const occupants = await redis.mGet(seatIds.map((seatId) => `seat:${roomId}:${seatId}`));
  return occupants.filter(Boolean).length;
}

function broadcastFreedSeat(io: ReturnType<typeof createGameServer>, spaceId: string, seat: SeatRef | null): void {
  if (seat) io.to(spaceChannel(spaceId)).emit("seat-update", { ...seat, playerId: null });
}

async function leaveCurrentRoom(socket: GameSocket): Promise<void> {
  const { currentRoomId, playerId } = socket.data;
  if (!currentRoomId || !playerId) return;
  socket.leave(roomChannel(currentRoomId));
  delete socket.data.currentRoomId;
  await redis.del(`room-access:${playerId}:${currentRoomId}`);
  // A client must not remain connected to a room after its socket membership ends.
  await removeMediaParticipant(`room:${currentRoomId}`, playerId);
}

export function createGameServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: config.corsOrigins, credentials: false },
    transports: ["websocket"],
    connectionStateRecovery: { maxDisconnectionDuration: LEAVE_GRACE_MS, skipMiddlewares: false }
  });

  io.use((socket, next) => {
    const parsed = socketAuthSchema.safeParse(socket.handshake.auth);
    const user = parsed.success ? verifyToken(parsed.data.token) : null;
    if (!user) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.userId = user.id;
    socket.data.username = user.username;
    next();
  });

  io.on("connection", (socket) => {
    // Correlation for every log line this connection produces. Re-bound with
    // playerId/spaceId once the player joins a space.
    let log = childLogger({ module: "socket", socketId: socket.id, userId: socket.data.userId, username: socket.data.username });
    const safeHandler = <T extends unknown[]>(event: string, handler: (...args: T) => Promise<void> | void) =>
      (...args: T) => void Promise.resolve(handler(...args)).catch((error) => log.error({ err: error, event }, "socket handler failed"));

    let joined = false;
    let joinTimeout: NodeJS.Timeout | undefined;
    if (socket.recovered && socket.data.playerId && socket.data.spaceId) {
      log = log.child({ playerId: socket.data.playerId, spaceId: socket.data.spaceId });
      const timeout = pendingLeaves.get(socket.data.playerId);
      if (timeout) clearTimeout(timeout);
      pendingLeaves.delete(socket.data.playerId);
      activeSockets.set(socket.data.playerId, socket);
      void redis.hSet(`presence:${socket.data.spaceId}`, socket.data.playerId, JSON.stringify({
        id: socket.data.playerId,
        name: socket.data.username,
        x: 320,
        y: 288,
        dir: "down",
        connectionId: socket.id
      }));
      joined = true;
      log.info("socket connection recovered");
    } else {
      log.info("socket connected");
    }

    if (!joined) joinTimeout = setTimeout(() => socket.disconnect(true), JOIN_TIMEOUT_MS);

    socket.on("join", safeHandler("join", async (payload) => {
      if (joined) return;
      const parsed = joinSchema.safeParse(payload);
      const { userId, username } = socket.data;
      if (!parsed.success || !userId || !username || !(await spaceExists(parsed.data.spaceId))) {
        socket.disconnect(true);
        return;
      }
      joined = true;
      if (joinTimeout) clearTimeout(joinTimeout);

      const previousSocket = activeSockets.get(userId);
      activeSockets.set(userId, socket);
      if (previousSocket && previousSocket.id !== socket.id) previousSocket.disconnect(true);

      const pending = pendingLeaves.get(userId);
      if (pending) clearTimeout(pending);
      pendingLeaves.delete(userId);

      socket.data.playerId = userId;
      socket.data.spaceId = parsed.data.spaceId;
      log = log.child({ playerId: userId, spaceId: parsed.data.spaceId });
      log.info("player joined space");
      await socket.join(spaceChannel(parsed.data.spaceId));

      const players = (await presenceFor(parsed.data.spaceId)).filter((player) => player.id !== userId);
      const self: PlayerState = { id: userId, name: username, x: 320, y: 288, dir: "down" };
      await redis.hSet(`presence:${parsed.data.spaceId}`, userId, JSON.stringify({ ...self, connectionId: socket.id }));
      socket.emit("init", { selfId: userId, players: [self, ...players] });
      socket.to(spaceChannel(parsed.data.spaceId)).emit("player-joined", self);

      const spaceRooms = await getSpace(parsed.data.spaceId);
      for (const room of spaceRooms?.rooms ?? []) await emitOccupiedSeats(socket, room.id);
    }));

    socket.on("move", safeHandler("move", async (payload) => {
      const parsed = moveSchema.safeParse(payload);
      const { playerId, spaceId, username } = socket.data;
      if (!parsed.success || !playerId || !spaceId || !username) return;
      const now = Date.now();
      if (socket.data.lastMoveAt && now - socket.data.lastMoveAt < 40) return;
      socket.data.lastMoveAt = now;
      const state = { id: playerId, name: username, ...parsed.data, connectionId: socket.id };
      await redis.hSet(`presence:${spaceId}`, playerId, JSON.stringify(state));
      socket.to(spaceChannel(spaceId)).emit("player-moved", { id: playerId, ...parsed.data });
    }));

    socket.on("chat", safeHandler("chat", (payload) => {
      const parsed = chatSchema.safeParse(payload);
      const { playerId, username, spaceId, currentRoomId } = socket.data;
      if (!parsed.success || !playerId || !username || !spaceId) return;
      // Default to your current room; "world" breaks out, "room" is a no-op outside one.
      // World chat reaches the whole space (incl. private-room members, whose client
      // shows it only under the "All" filter). Room chat stays room-only — no leak out.
      const toWorld = parsed.data.scope === "world" || !currentRoomId;
      const message = {
        id: playerId,
        name: username,
        text: parsed.data.text,
        scope: toWorld ? "world" : currentRoomId!
      };
      io.to(toWorld ? spaceChannel(spaceId) : roomChannel(currentRoomId!)).emit("chat", message);
    }));

    socket.on("whisper", safeHandler("whisper", async (payload) => {
      const parsed = whisperSchema.safeParse(payload);
      const { playerId, username, spaceId } = socket.data;
      if (!parsed.success || !playerId || !username || !spaceId) return;
      if (await isRateLimitExceeded(`whisper:${playerId}`, WHISPER_LIMIT, WHISPER_WINDOW_SECONDS)) return;
      const target = activeSockets.get(parsed.data.to);
      const targetName = target?.data.username;
      // Deliver only when the target is online and in the same space.
      if (!target || !targetName || target.data.spaceId !== spaceId) {
        socket.emit("whisper-fail", { name: parsed.data.to });
        return;
      }
      const message = {
        from: playerId,
        fromName: username,
        to: parsed.data.to,
        toName: targetName,
        text: parsed.data.text
      };
      target.emit("whisper", message);
      socket.emit("whisper", message); // echo so the sender sees their own line
    }));

    socket.on("room-enter", safeHandler("room-enter", async (payload) => {
      const parsed = roomEnterSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      if (await isRateLimitExceeded(
        `room-key-attempt:${playerId}:${parsed.data.roomId}`,
        ROOM_KEY_ATTEMPT_LIMIT,
        ROOM_KEY_ATTEMPT_WINDOW_SECONDS
      )) {
        socket.emit("room-enter-result", { ok: false, roomId: parsed.data.roomId, reason: "rate-limited" });
        return;
      }
      const room = await getRoom(parsed.data.roomId);
      if (!room || room.spaceId !== spaceId || !(await verifySecret(parsed.data.key, room.keyHash))) {
        socket.emit("room-enter-result", { ok: false, roomId: parsed.data.roomId, reason: "bad-key" });
        return;
      }
      const existingSeat = await redis.get(`player-seat:${playerId}`);
      const alreadySeatedHere = existingSeat?.startsWith(`seat:${room.id}:`) ?? false;
      if (!alreadySeatedHere && await occupiedCount(room.id) >= room.capacity) {
        socket.emit("room-enter-result", { ok: false, roomId: room.id, reason: "full" });
        return;
      }
      if (socket.data.currentRoomId && socket.data.currentRoomId !== room.id) await leaveCurrentRoom(socket);
      socket.data.currentRoomId = room.id;
      await socket.join(roomChannel(room.id));
      await redis.set(`room-access:${playerId}:${room.id}`, "1", { EX: 8 * 60 * 60 });
      // World and private-room media are mutually exclusive. This server-side
      // eviction prevents a stale client from leaking or receiving world audio.
      await removeMediaParticipant(`world:${spaceId}`, playerId);
      socket.emit("room-enter-result", { ok: true, roomId: room.id });
    }));

    socket.on("room-leave", safeHandler("room-leave", async () => {
      await leaveCurrentRoom(socket);
    }));

    socket.on("seat-sit", safeHandler("seat-sit", async (payload) => {
      const parsed = seatSitSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      const room = await getRoom(parsed.data.roomId);
      const hasAccess = await redis.exists(`room-access:${playerId}:${parsed.data.roomId}`);
      if (!room || room.spaceId !== spaceId || !hasAccess || !(await seatExists(room.id, parsed.data.seatId))) return;

      const result = await sitPlayer(playerId, room.id, parsed.data.seatId);
      if (!result.ok) {
        socket.emit("seat-update", { roomId: room.id, seatId: parsed.data.seatId, playerId: result.occupant });
        return;
      }
      if (result.previous && (result.previous.roomId !== room.id || result.previous.seatId !== parsed.data.seatId)) {
        broadcastFreedSeat(io, spaceId, result.previous);
        if (result.previous.roomId !== room.id) await removeMediaParticipant(`room:${result.previous.roomId}`, playerId);
      }
      io.to(spaceChannel(spaceId)).emit("seat-update", { roomId: room.id, seatId: parsed.data.seatId, playerId });
    }));

    socket.on("seat-stand", safeHandler("seat-stand", async () => {
      const { playerId, spaceId } = socket.data;
      if (!playerId || !spaceId) return;
      const previous = await standPlayer(playerId);
      broadcastFreedSeat(io, spaceId, previous);
      if (previous) await removeMediaParticipant(`room:${previous.roomId}`, playerId);
    }));

    socket.on("disconnect", (reason) => {
      if (joinTimeout) clearTimeout(joinTimeout);
      log.info({ reason }, "socket disconnected");
      const { playerId, spaceId } = socket.data;
      if (!playerId || !spaceId) return;
      const oldTimeout = pendingLeaves.get(playerId);
      if (oldTimeout) clearTimeout(oldTimeout);
      pendingLeaves.set(playerId, setTimeout(() => void (async () => {
        pendingLeaves.delete(playerId);
        if (activeSockets.get(playerId)?.id === socket.id) activeSockets.delete(playerId);
        const raw = await redis.hGet(`presence:${spaceId}`, playerId);
        const current = raw ? JSON.parse(raw) as { connectionId?: string } : null;
        if (current?.connectionId !== socket.id) return;
        await redis.hDel(`presence:${spaceId}`, playerId);
        if (socket.data.currentRoomId) await redis.del(`room-access:${playerId}:${socket.data.currentRoomId}`);
        const previous = await standPlayer(playerId);
        broadcastFreedSeat(io, spaceId, previous);
        if (previous) await removeMediaParticipant(`room:${previous.roomId}`, playerId);
        await removeMediaParticipant(`world:${spaceId}`, playerId);
        io.to(spaceChannel(spaceId)).emit("player-left", { id: playerId });
      })().catch((error) => log.error({ err: error }, "socket cleanup failed")), LEAVE_GRACE_MS));
    });
  });

  return io;
}
