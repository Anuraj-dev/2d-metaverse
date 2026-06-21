import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { verifyToken } from "./auth.js";
import { config } from "./config.js";
import { getRoom, getSeatIds, getSpace, seatExists, spaceExists } from "./repository.js";
import { redis } from "./redis.js";
import { sitPlayer, standPlayer } from "./seat-store.js";
import type { SeatRef } from "./seat-key.js";
import { verifySecret } from "./password.js";
import { removeMediaParticipant } from "./media.js";
import type { ClientToServerEvents, PlayerState, ServerToClientEvents, SocketData } from "./types.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const joinSchema = z.object({ token: z.string().min(1), spaceId: z.string().min(1).max(64) });
const moveSchema = z.object({
  x: z.number().finite().min(0).max(100_000),
  y: z.number().finite().min(0).max(100_000),
  dir: z.enum(["down", "left", "right", "up"])
});
const chatSchema = z.object({ text: z.string().trim().min(1).max(500) });
const roomEnterSchema = z.object({ roomId: z.string().min(1).max(64), key: z.string().min(1).max(128) });
const seatSitSchema = z.object({ roomId: z.string().min(1).max(64), seatId: z.number().int().nonnegative() });
const LEAVE_GRACE_MS = 4_000;

const spaceChannel = (spaceId: string) => `space:${spaceId}`;
const pendingLeaves = new Map<string, NodeJS.Timeout>();
const activeSockets = new Map<string, GameSocket>();

function safeHandler<T extends unknown[]>(handler: (...args: T) => Promise<void> | void) {
  return (...args: T) => void Promise.resolve(handler(...args)).catch((error) => console.error("Socket event failed", error));
}

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

export function createGameServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: config.corsOrigins, credentials: false },
    transports: ["websocket"],
    connectionStateRecovery: { maxDisconnectionDuration: LEAVE_GRACE_MS, skipMiddlewares: false }
  });

  io.on("connection", (socket) => {
    if (socket.recovered && socket.data.playerId && socket.data.spaceId) {
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
    }

    socket.on("join", safeHandler(async (payload) => {
      if (socket.data.playerId) return;
      const parsed = joinSchema.safeParse(payload);
      const user = parsed.success ? verifyToken(parsed.data.token) : null;
      if (!parsed.success || !user || !(await spaceExists(parsed.data.spaceId))) {
        socket.disconnect(true);
        return;
      }

      const previousSocket = activeSockets.get(user.id);
      activeSockets.set(user.id, socket);
      if (previousSocket && previousSocket.id !== socket.id) previousSocket.disconnect(true);

      const pending = pendingLeaves.get(user.id);
      if (pending) clearTimeout(pending);
      pendingLeaves.delete(user.id);

      socket.data.userId = user.id;
      socket.data.username = user.username;
      socket.data.playerId = user.id;
      socket.data.spaceId = parsed.data.spaceId;
      await socket.join(spaceChannel(parsed.data.spaceId));

      const players = (await presenceFor(parsed.data.spaceId)).filter((player) => player.id !== user.id);
      const self: PlayerState = { id: user.id, name: user.username, x: 320, y: 288, dir: "down" };
      await redis.hSet(`presence:${parsed.data.spaceId}`, user.id, JSON.stringify({ ...self, connectionId: socket.id }));
      socket.emit("init", { selfId: user.id, players: [self, ...players] });
      socket.to(spaceChannel(parsed.data.spaceId)).emit("player-joined", self);

      const spaceRooms = await getSpace(parsed.data.spaceId);
      for (const room of spaceRooms?.rooms ?? []) await emitOccupiedSeats(socket, room.id);
    }));

    socket.on("move", safeHandler(async (payload) => {
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

    socket.on("chat", safeHandler((payload) => {
      const parsed = chatSchema.safeParse(payload);
      const { playerId, username, spaceId, currentRoomId } = socket.data;
      if (!parsed.success || !playerId || !username || !spaceId) return;
      io.to(spaceChannel(spaceId)).emit("chat", {
        id: playerId,
        name: username,
        text: parsed.data.text,
        scope: currentRoomId ?? "world"
      });
    }));

    socket.on("room-enter", safeHandler(async (payload) => {
      const parsed = roomEnterSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
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
      socket.data.currentRoomId = room.id;
      await redis.set(`room-access:${playerId}:${room.id}`, "1", { EX: 8 * 60 * 60 });
      socket.emit("room-enter-result", { ok: true, roomId: room.id });
    }));

    socket.on("seat-sit", safeHandler(async (payload) => {
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

    socket.on("seat-stand", safeHandler(async () => {
      const { playerId, spaceId } = socket.data;
      if (!playerId || !spaceId) return;
      const previous = await standPlayer(playerId);
      broadcastFreedSeat(io, spaceId, previous);
      if (previous) await removeMediaParticipant(`room:${previous.roomId}`, playerId);
    }));

    socket.on("disconnect", () => {
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
        const previous = await standPlayer(playerId);
        broadcastFreedSeat(io, spaceId, previous);
        if (previous) await removeMediaParticipant(`room:${previous.roomId}`, playerId);
        await removeMediaParticipant(`world:${spaceId}`, playerId);
        io.to(spaceChannel(spaceId)).emit("player-left", { id: playerId });
      })().catch((error) => console.error("Socket cleanup failed", error)), LEAVE_GRACE_MS));
    });
  });

  return io;
}
