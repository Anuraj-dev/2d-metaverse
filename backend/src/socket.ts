import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import {
  BOARD_MATCH_TTL_SECONDS,
  BOARD_TABLES,
  RATE_LIMITS,
  boardTableLabel,
  REPORT_MESSAGE_TTL_SECONDS,
  approveKnockSchema,
  boardAcceptSchema,
  boardMoveSchema,
  boardSitSchema,
  boardUpdateSchema,
  cancelKnockSchema,
  chatSchema,
  denyKnockSchema,
  joinSchema,
  knockSchema,
  meetingChatSchema,
  moveSchema,
  seatSitSchema,
  socketAuthSchema,
  toggleAllowAllSchema,
  whisperSchema,
  type GeometryManifest,
} from "@metaverse/shared";
import { verifyToken } from "./auth.js";
import { blocks } from "./block-cache.js";
import { config } from "./config.js";
import { getGeometryManifest } from "./geometry.js";
import { createWalkability, validateMove, type Walkability } from "./movement.js";
import { PROXIMITY_TOLERANCE_TILES, nearRoomDoor, nearSeat } from "./proximity.js";
import { childLogger } from "./logger.js";
import { getRoom, getSeatIds, getSpace, getSuspension, seatExists, spaceExists } from "./repository.js";
import { isSuspended } from "./suspension.js";
import { checkRateLimit, isRateLimitExceeded, redis, storeReportableMessage } from "./redis.js";
import { sitPlayer, standPlayer } from "./seat-store.js";
import { createMeetingManager, type MeetingManager } from "./meeting-manager.js";
import type { RoomMeetingSnapshot } from "./meeting.js";
import { createBoardManager } from "./board-manager.js";
import { createRoomAdminManager, type RoomAdminManager, type RoomAdminSnapshot } from "./room-admin-manager.js";
import type { SeatRef } from "./seat-key.js";
import { removeMediaParticipant } from "./media.js";
import { buildPresenceSnapshot, type PresenceBoardInput, type PresenceRoomInput } from "./presence-read-model.js";
import { loadPilotSchedule, nextScheduledActivity } from "./pilot-schedule.js";
import { isInStageZone } from "./stage.js";
import type { ClientToServerEvents, PlayerState, ServerToClientEvents, SocketData } from "./types.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// Payload schemas + abuse-protection windows live in @metaverse/shared.
const CHAT_LIMIT = RATE_LIMITS.chatLimit;
const CHAT_WINDOW_SECONDS = RATE_LIMITS.chatWindowSeconds;
const WHISPER_LIMIT = RATE_LIMITS.whisperLimit;
const WHISPER_WINDOW_SECONDS = RATE_LIMITS.whisperWindowSeconds;
const MEETING_CHAT_LIMIT = RATE_LIMITS.meetingChatLimit;
const MEETING_CHAT_WINDOW_SECONDS = RATE_LIMITS.meetingChatWindowSeconds;
// Validated in parse-config.ts (positive finite integers; defaults 4s / 10s).
// Integration tests shrink them via env to exercise the timing paths quickly.
const LEAVE_GRACE_MS = config.LEAVE_GRACE_MS;
const JOIN_TIMEOUT_MS = config.JOIN_TIMEOUT_MS;
const KNOCK_LIMIT = RATE_LIMITS.knockLimit;
const KNOCK_WINDOW_SECONDS = RATE_LIMITS.knockWindowSeconds;

// Where new players enter the world: the campus map's authored spawn point
// (plaza centre, on the E-W artery — open in every direction). Matches the
// `spawn` object in campus.json and the WorldScene fallback.
const SPAWN_X = 960;
const SPAWN_Y = 704;

// The manifest is immutable for the process lifetime, so the derived per-tile
// walkability lookup is built once (keyed on the manifest instance to rebuild if
// a fixed manifest is hot-reloaded) and reused across every `move`.
let cachedWalkability: { manifest: GeometryManifest; walkable: Walkability } | undefined;
function walkabilityFor(manifest: GeometryManifest): Walkability {
  if (cachedWalkability?.manifest !== manifest) {
    cachedWalkability = {
      manifest,
      walkable: createWalkability(manifest.collision, manifest.solidObjects, manifest.tile.size),
    };
  }
  return cachedWalkability.walkable;
}

const spaceChannel = (spaceId: string) => `space:${spaceId}`;
const roomChannel = (roomId: string) => `room:${roomId}`;
// Board updates reach seated players + passing spectators via the space channel
// every joined player already subscribes to — scoped per space so a match in one
// space is invisible to another running the same campus map. The Redis mirror is
// likewise scoped by spaceId so table ids (map fixtures) never collide.
const boardKey = (spaceId: string, tableId: string) => `board:${spaceId}:${tableId}`;
// Live room-access state (admin, occupants, allow-all) mirrored per room. Cleared
// at boot by resetEphemeralGameState — restart drops every socket, so the mirror
// is never restored into a runtime (see room-admin-manager.ts).
const roomAdminKey = (roomId: string) => `room-admin:${roomId}`;
const pendingLeaves = new Map<string, NodeJS.Timeout>();
const activeSockets = new Map<string, GameSocket>();

/**
 * Immediately drop a user's live session (PRD 25.14). Called when a moderator
 * suspends them so the suspension takes effect without waiting for a reconnect.
 * Returns true when a live socket was found and disconnected. Sockets are keyed
 * by userId (= playerId), so this is a single-map lookup.
 */
export function disconnectUser(userId: string): boolean {
  const socket = activeSockets.get(userId);
  if (!socket) return false;
  socket.disconnect(true);
  return true;
}

/**
 * Socket-id "rooms" of every connected player in a block relation with `authorId`
 * (PRD 25.13). A broadcast excludes these so a blocked recipient never receives
 * the author's line — symmetric, so the same exclusion holds whichever party
 * authored. Empty when the author has no blocks, keeping the common path a plain
 * room broadcast.
 */
function blockedSocketRooms(authorId: string): string[] {
  const rooms: string[] = [];
  for (const otherId of blocks.relatedIds(authorId)) {
    const other = activeSockets.get(otherId);
    if (other) rooms.push(other.id);
  }
  return rooms;
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

function broadcastFreedSeat(io: ReturnType<typeof createGameServer>, spaceId: string, seat: SeatRef | null): void {
  if (seat) io.to(spaceChannel(spaceId)).emit("seat-update", { ...seat, playerId: null });
}

async function leaveCurrentRoom(
  socket: GameSocket,
  meetings: MeetingManager,
  roomAdmins: RoomAdminManager,
): Promise<void> {
  const { currentRoomId, playerId } = socket.data;
  if (!currentRoomId || !playerId) return;
  await socket.leave(roomChannel(currentRoomId));
  delete socket.data.currentRoomId;
  await redis.del(`room-access:${playerId}:${currentRoomId}`);
  // A client must not remain connected to a room after its socket membership ends.
  await removeMediaParticipant(`room:${currentRoomId}`, playerId);
  meetings.dispatch(currentRoomId, { type: "leave", playerId });
  // Room-access succession: the leaver may be the admin (promote next occupant).
  roomAdmins.dispatch(currentRoomId, { type: "leave", playerId });
}

/** Players holding one of the room's seats right now (Redis seat keys). */
async function seatedIn(roomId: string): Promise<string[]> {
  const seatIds = await getSeatIds(roomId);
  if (seatIds.length === 0) return [];
  const occupants = await redis.mGet(seatIds.map((seatId) => `seat:${roomId}:${seatId}`));
  return occupants.filter((playerId): playerId is string => Boolean(playerId));
}

export function createGameServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: config.corsOrigins, credentials: false },
    transports: ["websocket"],
    connectionStateRecovery: { maxDisconnectionDuration: LEAVE_GRACE_MS, skipMiddlewares: false }
  });

  // Meeting-start trigger (PRD 10): the pure rules live in meeting.ts; this
  // shell derives room snapshots from the Socket.IO adapter (who is in the
  // room zone) + Redis seat keys (who is seated) and broadcasts room-scoped.
  const meetings = createMeetingManager({
    countdownMs: config.MEETING_COUNTDOWN_MS,
    getSnapshot: async (roomId): Promise<RoomMeetingSnapshot> => {
      const socketIds = io.sockets.adapter.rooms.get(roomChannel(roomId)) ?? new Set<string>();
      const occupants: string[] = [];
      for (const socketId of socketIds) {
        const memberId = io.sockets.sockets.get(socketId)?.data.playerId;
        if (memberId) occupants.push(memberId);
      }
      return { occupants, seated: await seatedIn(roomId) };
    },
    resolveName: (playerId) => activeSockets.get(playerId)?.data.username ?? playerId,
    broadcast: (roomId, event, ...payload) => {
      io.to(roomChannel(roomId)).emit(event, ...payload);
      // A meeting starting/ending flips its room between "room" and "meeting" in
      // the social-arrival read model — re-broadcast the space's presence snapshot.
      if (event === "meeting-started" || event === "meeting-ended") {
        void getRoom(roomId).then((room) => {
          if (room) refreshPresence(room.spaceId);
        });
      }
    },
    // In-meeting chat is delivered per-participant (never the room channel), so
    // an unseated occupant sharing the room zone can't eavesdrop on the meeting.
    sendToPlayer: (playerId, event, ...payload) => activeSockets.get(playerId)?.emit(event, ...payload),
    // Block filtering for in-meeting chat (PRD 25.13), both directions.
    canDeliver: (senderId, recipientId) => !blocks.isBlockedPair(senderId, recipientId),
    log: childLogger({ module: "meeting" }),
  });

  // Board-game tables (PRD 11 phase 2): pure match rules live in boardMatch.ts;
  // this shell broadcasts each authoritative snapshot to the space channel (seated
  // players + spectators) and mirrors live matches into per-space Redis keys with
  // a TTL. Everything is scoped by spaceId so shared table ids never collide.
  const boards = createBoardManager({
    graceMs: LEAVE_GRACE_MS,
    ttlSeconds: BOARD_MATCH_TTL_SECONDS,
    resolveName: (playerId) => activeSockets.get(playerId)?.data.username ?? playerId,
    broadcast: (spaceId, payload) => {
      io.to(spaceChannel(spaceId)).emit("board-update", payload);
      // Sitting/standing/finishing a match changes who is "at a board" — refresh.
      refreshPresence(spaceId);
    },
    sendError: (playerId, payload) => activeSockets.get(playerId)?.emit("board-error", payload),
    persist: (spaceId, tableId, snapshot) => {
      const done =
        snapshot === null
          ? redis.del(boardKey(spaceId, tableId))
          : redis.set(boardKey(spaceId, tableId), JSON.stringify(snapshot), { EX: BOARD_MATCH_TTL_SECONDS });
      void done.catch((error: unknown) => childLogger({ module: "board" }).error({ err: error, spaceId, tableId }, "board persist failed"));
    },
    load: async (spaceId, tableId) => {
      // Restart recovery: reload the persisted snapshot (TTL enforced by Redis).
      // Validate our own mirror so a stale/format-changed key degrades to "no
      // match" instead of corrupting a runtime.
      const raw = await redis.get(boardKey(spaceId, tableId));
      if (!raw) return null;
      const parsed = boardUpdateSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        childLogger({ module: "board" }).warn({ spaceId, tableId }, "discarding unparseable board snapshot");
        return null;
      }
      return parsed.data;
    },
    log: childLogger({ module: "board" }),
  });

  // Room-access admin/knock system (PRD 14): the pure rules live in roomAdmin.ts;
  // this shell writes the room-access grant on admission, runs knock-timeout
  // timers, and fans effects out to the room channel (admin/occupants), the space
  // channel (door visibility), and individual sockets (knock results, capacity).
  const roomAdmins: RoomAdminManager = createRoomAdminManager({
    knockTimeoutMs: config.KNOCK_TIMEOUT_MS,
    getRoomContext: async (roomId) => {
      const room = await getRoom(roomId);
      return room ? { capacity: room.capacity, spaceId: room.spaceId } : null;
    },
    resolveName: (playerId) => activeSockets.get(playerId)?.data.username ?? playerId,
    admit: async (roomId, playerId, _asAdmin) => {
      const socket = activeSockets.get(playerId);
      const spaceId = socket?.data.spaceId;
      if (!socket || !spaceId) return;
      if (socket.data.currentRoomId && socket.data.currentRoomId !== roomId) {
        await leaveCurrentRoom(socket, meetings, roomAdmins);
      }
      socket.data.currentRoomId = roomId;
      await socket.join(roomChannel(roomId));
      await redis.set(`room-access:${playerId}:${roomId}`, "1", { EX: 8 * 60 * 60 });
      // World and private-room media are mutually exclusive: evict any world seat.
      await removeMediaParticipant(`world:${spaceId}`, playerId);
      // A fresh (unseated) entry cancels a pending meeting countdown; a seated
      // re-entry (reconnect within grace) must not.
      const existingSeat = await redis.get(`player-seat:${playerId}`);
      if (!(existingSeat?.startsWith(`seat:${roomId}:`) ?? false)) {
        meetings.dispatch(roomId, { type: "enter", playerId });
      }
      // Entering a private room moves the student out of "world" — refresh arrival.
      refreshPresence(spaceId);
    },
    toRoom: (roomId, event, ...payload) => io.to(roomChannel(roomId)).emit(event, ...payload),
    toSpace: (spaceId, event, ...payload) => io.to(spaceChannel(spaceId)).emit(event, ...payload),
    toPlayer: (playerId, event, ...payload) => activeSockets.get(playerId)?.emit(event, ...payload),
    persist: (roomId, snapshot: RoomAdminSnapshot | null) => {
      const done =
        snapshot === null
          ? redis.del(roomAdminKey(roomId))
          : redis.set(roomAdminKey(roomId), JSON.stringify(snapshot), { EX: 8 * 60 * 60 });
      void done.catch((error: unknown) => childLogger({ module: "room-admin" }).error({ err: error, roomId }, "room-admin persist failed"));
    },
    log: childLogger({ module: "room-admin" }),
  });

  const presenceLog = childLogger({ module: "presence" });

  // Assemble the server-owned social-arrival read model (PRD 25.26) for a space
  // from authoritative live state: Redis presence positions, room-channel
  // membership, live meetings, board matches, stage-zone occupancy, and the
  // validated pilot schedule. The rules (who is in which activity) live in the
  // pure buildPresenceSnapshot; this only gathers inputs.
  async function gatherSpacePresence(spaceId: string) {
    const online = (await redis.hVals(`presence:${spaceId}`)).flatMap((value) => {
      try {
        const p = JSON.parse(value) as PlayerState;
        return [{ id: p.id, name: p.name, x: p.x, y: p.y }];
      } catch {
        return [];
      }
    });

    const space = await getSpace(spaceId);
    const activeMeetings = new Set(meetings.activeMeetingRooms());
    const rooms: PresenceRoomInput[] = (space?.rooms ?? []).map((room) => {
      const socketIds = io.sockets.adapter.rooms.get(roomChannel(room.id)) ?? new Set<string>();
      const occupants: string[] = [];
      for (const socketId of socketIds) {
        const memberId = io.sockets.sockets.get(socketId)?.data.playerId;
        if (memberId) occupants.push(memberId);
      }
      return { id: room.id, label: room.name, occupants, meetingActive: activeMeetings.has(room.id) };
    });

    const boardInputs: PresenceBoardInput[] = [];
    for (const { id } of BOARD_TABLES) {
      const snap = await boards.currentSnapshot(spaceId, id);
      if (!snap) continue;
      const seated = snap.seats.flatMap((seat) => (seat ? [seat.id] : []));
      boardInputs.push({ id, label: boardTableLabel(id), seated });
    }

    const stageOccupantIds = online.filter((p) => isInStageZone(p.x, p.y)).map((p) => p.id);
    const nextScheduled = nextScheduledActivity(loadPilotSchedule());

    return buildPresenceSnapshot({
      spaceId,
      online,
      rooms,
      boards: boardInputs,
      stageOccupantIds,
      nextScheduled,
    });
  }

  // Recompute + broadcast the space's presence snapshot on a membership/activity
  // change (join, leave, room enter/leave, meeting start/end, board change).
  // Fire-and-forget: telemetry-grade — a failure must never break the game.
  function refreshPresence(spaceId: string): void {
    void gatherSpacePresence(spaceId)
      .then((snapshot) => io.to(spaceChannel(spaceId)).emit("presence-snapshot", snapshot))
      .catch((error: unknown) => presenceLog.error({ err: error, spaceId }, "presence refresh failed"));
  }

  io.use((socket, next) => {
    const parsed = socketAuthSchema.safeParse(socket.handshake.auth);
    const user = parsed.success ? verifyToken(parsed.data.token) : null;
    if (!user) {
      next(new Error("unauthorized"));
      return;
    }
    // Suspension gate (PRD 25.14): a suspended user cannot open a socket. One
    // indexed PK lookup on connect (not per-message) — cheap for a connection
    // event, and reading the row directly avoids any cache-coherency window when
    // a moderator suspends/reverses moments earlier.
    void getSuspension(user.id)
      .then((record) => {
        if (isSuspended(record, Date.now())) {
          next(new Error("suspended"));
          return;
        }
        socket.data.userId = user.id;
        socket.data.username = user.username;
        next();
      })
      .catch((error: unknown) => {
        childLogger({ module: "socket" }).error({ err: error }, "suspension check failed");
        next(new Error("unauthorized"));
      });
  });

  io.on("connection", (socket) => {
    // Correlation for every log line this connection produces. Re-bound with
    // playerId/spaceId once the player joins a space.
    let log = childLogger({ module: "socket", socketId: socket.id, userId: socket.data.userId, username: socket.data.username });
    let recoveryReady = Promise.resolve();
    const safeHandler = <T extends unknown[]>(event: string, handler: (...args: T) => Promise<void> | void) =>
      (...args: T) => void recoveryReady.then(() => handler(...args)).catch((error) => log.error({ err: error, event }, "socket handler failed"));

    let joined = false;
    let joinTimeout: NodeJS.Timeout | undefined;
    if (socket.recovered && socket.data.playerId && socket.data.spaceId && socket.data.username) {
      log = log.child({ playerId: socket.data.playerId, spaceId: socket.data.spaceId });
      const timeout = pendingLeaves.get(socket.data.playerId);
      if (timeout) clearTimeout(timeout);
      pendingLeaves.delete(socket.data.playerId);
      boards.cancelForfeit(socket.data.playerId);
      joined = true;
      const playerId = socket.data.playerId;
      const spaceId = socket.data.spaceId;
      const username = socket.data.username;
      recoveryReady = (async () => {
        const raw = await redis.hGet(`presence:${spaceId}`, playerId);
        let restored: ReturnType<typeof moveSchema.safeParse> | null = null;
        try {
          restored = moveSchema.safeParse(raw ? JSON.parse(raw) : null);
        } catch {
          // Invalid JSON follows the same safe fallback as an invalid shape.
        }
        const position = restored?.success
          ? restored.data
          : { x: SPAWN_X, y: SPAWN_Y, dir: "down" as const };
        if (!restored?.success) log.warn("invalid recovered presence; restoring spawn");
        const self: PlayerState = { id: playerId, name: username, ...position };
        // Re-seed the movement envelope from the recovered position; the first
        // move after recovery re-anchors, since the client may have kept walking
        // while its buffered moves were held during the disconnect.
        socket.data.moveAnchor = { x: position.x, y: position.y, dir: position.dir, at: Date.now() };
        socket.data.moveJustEntered = true;
        // One Redis write transfers connection ownership and position together;
        // the expired socket's grace cleanup cannot delete the recovered state.
        await redis.hSet(`presence:${spaceId}`, playerId, JSON.stringify({ ...self, connectionId: socket.id }));
        activeSockets.set(playerId, socket);
        // Refresh block-pair filtering before this recovered session resumes chat.
        await blocks.ensureLoaded(playerId);
        const players = (await presenceFor(spaceId)).filter((player) => player.id !== playerId);
        socket.emit("init", { selfId: playerId, players: [self, ...players] });
        log.info("socket connection recovered");
      })().catch((error: unknown) => {
        log.error({ err: error }, "socket recovery failed");
        socket.disconnect(true);
      });
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
      // Load this player's block relations before any chat can flow (PRD 25.13),
      // so delivery filtering is correct from their first line — both the ids they
      // blocked and the ids that blocked them.
      await blocks.ensureLoaded(userId);
      log = log.child({ playerId: userId, spaceId: parsed.data.spaceId });
      log.info("player joined space");
      await socket.join(spaceChannel(parsed.data.spaceId));

      const players = (await presenceFor(parsed.data.spaceId)).filter((player) => player.id !== userId);
      const self: PlayerState = { id: userId, name: username, x: SPAWN_X, y: SPAWN_Y, dir: "down" };
      // Seed the movement envelope at spawn; the first move re-anchors (see move handler).
      socket.data.moveAnchor = { x: SPAWN_X, y: SPAWN_Y, dir: "down", at: Date.now() };
      socket.data.moveJustEntered = true;
      await redis.hSet(`presence:${parsed.data.spaceId}`, userId, JSON.stringify({ ...self, connectionId: socket.id }));
      socket.emit("init", { selfId: userId, players: [self, ...players] });
      socket.to(spaceChannel(parsed.data.spaceId)).emit("player-joined", self);

      const spaceRooms = await getSpace(parsed.data.spaceId);
      for (const room of spaceRooms?.rooms ?? []) await emitOccupiedSeats(socket, room.id);

      // Board tables live on the space channel (already joined above): sync each
      // table's current match state so a latecomer sees any in-progress game
      // without waiting for the next move. currentSnapshot hydrates from Redis on
      // first touch, so matches survive a backend restart.
      for (const { id } of BOARD_TABLES) {
        const snap = await boards.currentSnapshot(parsed.data.spaceId, id);
        if (snap) socket.emit("board-update", snap);
      }

      // Social arrival (PRD 25.26): re-broadcast the space's presence snapshot so
      // the arriving student (and everyone already here) sees a populated campus.
      refreshPresence(parsed.data.spaceId);
    }));

    socket.on("move", safeHandler("move", async (payload) => {
      const parsed = moveSchema.safeParse(payload);
      const { playerId, spaceId, username } = socket.data;
      if (!parsed.success || !playerId || !spaceId || !username) return;
      const now = Date.now();
      if (socket.data.lastMoveAt && now - socket.data.lastMoveAt < RATE_LIMITS.moveThrottleMs) return;
      socket.data.lastMoveAt = now;

      // Authoritative movement envelope (PRD 25.21): reject impossible deltas and
      // out-of-bounds moves. The last accepted position stays authoritative — a
      // rejected move is neither stored nor broadcast; the offender gets a
      // correction snapping it back to that position. Rules live in the pure
      // `validateMove`; this shell only feeds it the anchor + geometry manifest.
      const manifest = getGeometryManifest();
      const anchor = socket.data.moveAnchor ?? { x: SPAWN_X, y: SPAWN_Y, dir: "down" as const, at: now };
      const decision = validateMove(anchor, parsed.data, now, {
        world: manifest.world,
        portals: manifest.portals,
        walkable: walkabilityFor(manifest),
        tileSize: manifest.tile.size,
        justEntered: socket.data.moveJustEntered ?? false,
      });
      socket.data.moveJustEntered = false;
      if (!decision.ok) {
        // Privacy-safe security telemetry: playerId + reason only, never raw
        // coordinate streams (the bound logger already carries playerId/spaceId).
        log.child({ module: "movement" }).warn(
          { event: "move_rejected", reason: decision.reason },
          "movement rejected",
        );
        socket.emit("move-correction", { x: anchor.x, y: anchor.y, dir: anchor.dir, reason: decision.reason });
        return;
      }

      socket.data.moveAnchor = { x: parsed.data.x, y: parsed.data.y, dir: parsed.data.dir, at: now };
      const state = { id: playerId, name: username, ...parsed.data, connectionId: socket.id };
      await redis.hSet(`presence:${spaceId}`, playerId, JSON.stringify(state));
      socket.to(spaceChannel(spaceId)).emit("player-moved", { id: playerId, ...parsed.data });
    }));

    socket.on("chat", safeHandler("chat", async (payload) => {
      const parsed = chatSchema.safeParse(payload);
      const { playerId, username, spaceId, currentRoomId } = socket.data;
      if (!parsed.success || !playerId || !username || !spaceId) return;
      // Anti-spam (PRD 25.11): world and room lines share one per-player window.
      // Excess is refused with a typed cooldown carrying retry timing — never a
      // silent drop — so the sender's ChatBox can explain the wait.
      const limited = await checkRateLimit(`chat:${playerId}`, CHAT_LIMIT, CHAT_WINDOW_SECONDS);
      if (limited.exceeded) {
        socket.emit("chat-cooldown", { scope: "world", retryAfterMs: limited.retryAfterMs });
        return;
      }
      // Default to your current room; "world" breaks out, "room" is a no-op outside one.
      // World chat reaches the whole space (incl. private-room members, whose client
      // shows it only under the "All" filter). Room chat stays room-only — no leak out.
      const toWorld = parsed.data.scope === "world" || !currentRoomId;
      const scope = toWorld ? "world" : currentRoomId;
      // Server-stamped identity (PRD 25.12): a unique id + send time the client can
      // never forge. The same id reaches every recipient, so a report references
      // exactly one line and we can bind its author/text from our own snapshot.
      const messageId = randomUUID();
      const ts = Date.now();
      const message = { id: playerId, name: username, text: parsed.data.text, scope, messageId, ts };
      // Keep a bounded snapshot so a later report binds the authoritative
      // author/text without trusting the reporter or storing a transcript.
      await storeReportableMessage(
        messageId,
        { authorId: playerId, authorName: username, text: parsed.data.text, scope, spaceId, ts },
        REPORT_MESSAGE_TTL_SECONDS,
      );
      // Block filtering (PRD 25.13): exclude every recipient in a block relation
      // with the author, in both directions. The exclusion is by socket id, so the
      // author still sees their own line and unrelated members are untouched.
      const channel = toWorld ? spaceChannel(spaceId) : roomChannel(currentRoomId);
      const excluded = blockedSocketRooms(playerId);
      const target = excluded.length > 0 ? io.to(channel).except(excluded) : io.to(channel);
      target.emit("chat", message);
    }));

    // In-meeting chat (PRD 10): scoped to the sender's live meeting. The meeting
    // manager owns the participant set and per-socket fan-out — this handler only
    // validates the wire shape, rate-limits, and hands off; membership/scoping is
    // decided there (a non-participant, or a room with no live meeting, is a no-op).
    socket.on("meeting-chat", safeHandler("meeting-chat", async (payload) => {
      const parsed = meetingChatSchema.safeParse(payload);
      const { playerId, currentRoomId } = socket.data;
      if (!parsed.success || !playerId || !currentRoomId) return;
      const limited = await checkRateLimit(`meeting-chat:${playerId}`, MEETING_CHAT_LIMIT, MEETING_CHAT_WINDOW_SECONDS);
      if (limited.exceeded) {
        socket.emit("chat-cooldown", { scope: "meeting", retryAfterMs: limited.retryAfterMs });
        return;
      }
      meetings.chat(currentRoomId, playerId, parsed.data.text);
    }));

    socket.on("whisper", safeHandler("whisper", async (payload) => {
      const parsed = whisperSchema.safeParse(payload);
      const { playerId, username, spaceId } = socket.data;
      if (!parsed.success || !playerId || !username || !spaceId) return;
      const limited = await checkRateLimit(`whisper:${playerId}`, WHISPER_LIMIT, WHISPER_WINDOW_SECONDS);
      if (limited.exceeded) {
        socket.emit("chat-cooldown", { scope: "whisper", retryAfterMs: limited.retryAfterMs });
        return;
      }
      const target = activeSockets.get(parsed.data.to);
      const targetName = target?.data.username;
      // Deliver only when the target is online and in the same space. A block in
      // either direction (PRD 25.13) is treated as undeliverable — the same coarse
      // whisper-fail as an absent target, so block status is never leaked.
      if (
        !target ||
        !targetName ||
        target.data.spaceId !== spaceId ||
        blocks.isBlockedPair(playerId, parsed.data.to)
      ) {
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

    // Room access (PRD 14): a knock is a request to enter. The pure machine
    // (via roomAdmins) decides — admit as admin (empty room), auto-admit
    // (allow-all under capacity), enqueue for the admin, or turn away (full).
    // All authority lives server-side; the client only asks.
    socket.on("knock", safeHandler("knock", async (payload) => {
      const parsed = knockSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      // Already inside this room? Nothing to knock for.
      if (socket.data.currentRoomId === parsed.data.roomId) return;
      const room = await getRoom(parsed.data.roomId);
      if (!room || room.spaceId !== spaceId) return;
      // Authoritative door proximity (PRD 25.23): a knock is a physical action —
      // the knocker must actually be standing at THIS room's door. Checked
      // against the server's own last-accepted position (`moveAnchor`), never a
      // client-supplied coordinate, so a remote/cross-room knock cannot admit.
      // A typed `too-far` result (not a silent drop) keeps the knocker's UI from
      // hanging on a "Knocking…" state that will never resolve.
      const manifest = getGeometryManifest();
      const anchor = socket.data.moveAnchor ?? { x: SPAWN_X, y: SPAWN_Y };
      const tolerance = PROXIMITY_TOLERANCE_TILES * manifest.tile.size;
      if (!nearRoomDoor(anchor, manifest.doors, room.id, tolerance)) {
        log.child({ module: "proximity" }).warn(
          { event: "knock_denied", reason: "too-far", roomId: room.id },
          "knock rejected: not at door",
        );
        socket.emit("knock-result", { roomId: room.id, result: "too-far" });
        return;
      }
      // Anti-harassment: cap knock attempts per player+room.
      if (await isRateLimitExceeded(`knock:${playerId}:${room.id}`, KNOCK_LIMIT, KNOCK_WINDOW_SECONDS)) return;
      socket.data.knockRoomId = room.id;
      roomAdmins.dispatch(room.id, { type: "knock", playerId });
    }));

    socket.on("cancel-knock", safeHandler("cancel-knock", (payload) => {
      const parsed = cancelKnockSchema.safeParse(payload);
      const { playerId } = socket.data;
      if (!parsed.success || !playerId) return;
      roomAdmins.dispatch(parsed.data.roomId, { type: "cancel-knock", playerId });
    }));

    socket.on("approve-knock", safeHandler("approve-knock", (payload) => {
      const parsed = approveKnockSchema.safeParse(payload);
      const { playerId } = socket.data;
      if (!parsed.success || !playerId) return;
      // `by` is the authenticated actor; the machine rejects non-admins.
      roomAdmins.dispatch(parsed.data.roomId, { type: "approve", by: playerId, playerId: parsed.data.playerId });
    }));

    socket.on("deny-knock", safeHandler("deny-knock", (payload) => {
      const parsed = denyKnockSchema.safeParse(payload);
      const { playerId } = socket.data;
      if (!parsed.success || !playerId) return;
      roomAdmins.dispatch(parsed.data.roomId, { type: "deny", by: playerId, playerId: parsed.data.playerId });
    }));

    socket.on("toggle-allow-all", safeHandler("toggle-allow-all", (payload) => {
      const parsed = toggleAllowAllSchema.safeParse(payload);
      const { playerId } = socket.data;
      if (!parsed.success || !playerId) return;
      roomAdmins.dispatch(parsed.data.roomId, { type: "toggle-allow-all", by: playerId, value: parsed.data.allowAll });
    }));

    socket.on("room-leave", safeHandler("room-leave", async () => {
      const { spaceId } = socket.data;
      await leaveCurrentRoom(socket, meetings, roomAdmins);
      // Leaving a room returns the student to the open world — refresh arrival.
      if (spaceId) refreshPresence(spaceId);
    }));

    socket.on("seat-sit", safeHandler("seat-sit", async (payload) => {
      const parsed = seatSitSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      const room = await getRoom(parsed.data.roomId);
      if (!room || room.spaceId !== spaceId || !(await seatExists(room.id, parsed.data.seatId))) return;

      // Authoritative sit gate (PRD 25.23): acquiring a private seat requires
      // server-tracked current-room membership (the socket's joined room, NOT a
      // client-claimed roomId), a live access grant, AND anchor proximity to the
      // seat coordinate. Each failure is a TYPED `seat-denied` (never a silent
      // drop) so a spoofed client cannot phantom-sit and honest UI never hangs.
      // Ordered cheapest-first; membership catches the "claiming a room I never
      // entered / left" case before any geometry work.
      const denySeat = (reason: "not-in-room" | "no-access" | "too-far"): void => {
        log.child({ module: "proximity" }).warn(
          { event: "seat_denied", reason, roomId: room.id, seatId: parsed.data.seatId },
          "seat-sit rejected",
        );
        socket.emit("seat-denied", { roomId: room.id, seatId: parsed.data.seatId, reason });
      };
      if (socket.data.currentRoomId !== room.id) return denySeat("not-in-room");
      if (!(await redis.exists(`room-access:${playerId}:${room.id}`))) return denySeat("no-access");
      const manifest = getGeometryManifest();
      const seat = manifest.seats.find(
        (s) => s.roomId === room.id && s.seatId === parsed.data.seatId,
      );
      const anchor = socket.data.moveAnchor ?? { x: SPAWN_X, y: SPAWN_Y };
      const tolerance = PROXIMITY_TOLERANCE_TILES * manifest.tile.size;
      if (!seat || !nearSeat(anchor, seat, manifest.tile.size, tolerance)) return denySeat("too-far");

      const result = await sitPlayer(playerId, room.id, parsed.data.seatId);
      if (!result.ok) {
        socket.emit("seat-update", { roomId: room.id, seatId: parsed.data.seatId, playerId: result.occupant });
        return;
      }
      if (result.previous && (result.previous.roomId !== room.id || result.previous.seatId !== parsed.data.seatId)) {
        broadcastFreedSeat(io, spaceId, result.previous);
        if (result.previous.roomId !== room.id) {
          await removeMediaParticipant(`room:${result.previous.roomId}`, playerId);
          meetings.dispatch(result.previous.roomId, { type: "stand", playerId });
        }
      }
      io.to(spaceChannel(spaceId)).emit("seat-update", { roomId: room.id, seatId: parsed.data.seatId, playerId });
      meetings.dispatch(room.id, { type: "sit", playerId });
    }));

    socket.on("seat-stand", safeHandler("seat-stand", async () => {
      const { playerId, spaceId } = socket.data;
      if (!playerId || !spaceId) return;
      const previous = await standPlayer(playerId);
      broadcastFreedSeat(io, spaceId, previous);
      if (previous) {
        await removeMediaParticipant(`room:${previous.roomId}`, playerId);
        meetings.dispatch(previous.roomId, { type: "stand", playerId });
      }
    }));

    socket.on("board-sit", safeHandler("board-sit", (payload) => {
      const parsed = boardSitSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      boards.dispatch(spaceId, parsed.data.tableId, { type: "sit", seat: parsed.data.seat as 0 | 1, playerId });
    }));

    socket.on("board-stand", safeHandler("board-stand", () => {
      const { playerId, spaceId } = socket.data;
      if (!playerId || !spaceId) return;
      boards.stand(spaceId, playerId);
    }));

    socket.on("board-accept", safeHandler("board-accept", (payload) => {
      const parsed = boardAcceptSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      boards.dispatch(spaceId, parsed.data.tableId, { type: "accept", playerId });
    }));

    socket.on("board-move", safeHandler("board-move", (payload) => {
      const parsed = boardMoveSchema.safeParse(payload);
      const { playerId, spaceId } = socket.data;
      if (!parsed.success || !playerId || !spaceId) return;
      // No throttle needed: a move is turn-gated (at most one legal move per turn)
      // and any extra/illegal move is rejected cheaply by the pure machine.
      boards.dispatch(spaceId, parsed.data.tableId, { type: "move", playerId, index: parsed.data.index });
    }));

    socket.on("disconnect", (reason) => {
      if (joinTimeout) clearTimeout(joinTimeout);
      log.info({ reason }, "socket disconnected");
      const { playerId, spaceId } = socket.data;
      if (!playerId || !spaceId) return;
      // Board match: forfeit after the same grace window (a recovered socket
      // cancels it). No board reconnect restores the seat, so this frees the table.
      boards.scheduleForfeit(spaceId, playerId);
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
        // The departed student drops out of the social-arrival read model.
        refreshPresence(spaceId);
        // Meeting semantics: leaving past grace is a stand (participant-left /
        // meeting-ended); an unseated occupant evaporating can also complete
        // the all-seated picture for those remaining.
        if (previous) meetings.dispatch(previous.roomId, { type: "stand", playerId });
        else if (socket.data.currentRoomId) meetings.dispatch(socket.data.currentRoomId, { type: "leave", playerId });
        // Room-access: an admin disconnecting past grace hands off (succession);
        // a pending knocker disconnecting withdraws their knock.
        if (socket.data.currentRoomId) roomAdmins.dispatch(socket.data.currentRoomId, { type: "leave", playerId });
        if (socket.data.knockRoomId && socket.data.knockRoomId !== socket.data.currentRoomId) {
          roomAdmins.dispatch(socket.data.knockRoomId, { type: "leave", playerId });
        }
      })().catch((error) => log.error({ err: error }, "socket cleanup failed")), LEAVE_GRACE_MS));
    });
  });

  return io;
}
