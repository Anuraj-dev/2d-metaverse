/**
 * Side-effect shell around the pure room-access machine (roomAdmin.ts). Owns
 * per-room machine state, the per-knock timeout timers, a Redis mirror of the
 * live state (with TTL), and the translation of machine effects into
 * room-scoped, space-scoped, and per-player socket messages plus the actual
 * room-access grant write (via the injected `admit`).
 *
 * Modeled on meeting-manager.ts: dependencies are injected so the manager stays
 * unit-testable without Socket.IO or Redis, and dispatches are serialized per
 * room through a promise queue — each event awaits a fresh room context
 * (capacity + space) so two racing knocks cannot interleave their transitions.
 *
 * The Redis mirror is write-through only: on a process restart every socket is
 * gone, so restoring occupants would strand ghosts. The mirror is therefore
 * cleared at boot via `resetEphemeralGameState` (the `room-admin:*` prefix) and
 * exists for observability + parity with the board mirror, never for restore.
 */
import type { ServerToClientEvents } from "@metaverse/shared";
import {
  EMPTY_ROOM,
  roomAdminTransition,
  type RoomAdminEvent,
  type RoomAdminState,
} from "./roomAdmin.js";
import type { Logger } from "pino";

type RoomBroadcast = <E extends keyof ServerToClientEvents>(
  target: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) => void;

/** The live state mirrored to Redis (transient knock timers are not persisted). */
export interface RoomAdminSnapshot {
  admin: string | null;
  occupants: string[];
  allowAll: boolean;
}

export interface RoomAdminManagerDeps {
  knockTimeoutMs: number;
  /** Per-room capacity + owning space, or null for an unknown room. */
  getRoomContext: (roomId: string) => Promise<{ capacity: number; spaceId: string } | null>;
  resolveName: (playerId: string) => string;
  /**
   * Perform the admission side effects for a player: join the room channel,
   * write the room-access grant, evict world media, and feed the meeting
   * trigger. Resolves once the grant is durably in place.
   */
  admit: (roomId: string, playerId: string, asAdmin: boolean) => Promise<void>;
  /** Broadcast to everyone in the room channel (occupants + admin). */
  toRoom: RoomBroadcast;
  /** Broadcast to the whole space (door visibility for players near the door). */
  toSpace: RoomBroadcast;
  /** Send directly to a single player's socket (no-op if offline). */
  toPlayer: RoomBroadcast;
  /** Persist (or clear, when null) the Redis mirror of a room's state. */
  persist: (roomId: string, snapshot: RoomAdminSnapshot | null) => void;
  log: Logger;
}

export interface RoomAdminManager {
  /** Feed a room-access event; effects broadcast asynchronously. */
  dispatch: (roomId: string, event: RoomAdminEvent) => void;
  /** The current pending-knock count for a room (test/introspection only). */
  settle: () => Promise<void>;
}

interface RoomRuntime {
  state: RoomAdminState;
  knockTimers: Map<string, NodeJS.Timeout>;
  queue: Promise<void>;
  /** Dispatches queued or running; the room entry may only be dropped at 0. */
  pending: number;
}

export function createRoomAdminManager(deps: RoomAdminManagerDeps): RoomAdminManager {
  const rooms = new Map<string, RoomRuntime>();

  const named = (playerId: string): { id: string; name: string } => ({ id: playerId, name: deps.resolveName(playerId) });

  const snapshotOf = (state: RoomAdminState): RoomAdminSnapshot | null =>
    state === EMPTY_ROOM || (state.admin === null && state.occupants.length === 0)
      ? null
      : { admin: state.admin, occupants: [...state.occupants], allowAll: state.allowAll };

  const clearKnockTimer = (room: RoomRuntime, playerId: string): void => {
    const timer = room.knockTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      room.knockTimers.delete(playerId);
    }
  };

  const apply = async (roomId: string, room: RoomRuntime, event: RoomAdminEvent): Promise<void> => {
    const ctx = await deps.getRoomContext(roomId);
    if (!ctx) {
      deps.log.warn({ roomId, event: event.type }, "room-admin dispatch for unknown room");
      return;
    }
    const { state, effects } = roomAdminTransition(room.state, event, { capacity: ctx.capacity });
    room.state = state;

    for (const effect of effects) {
      switch (effect.type) {
        case "admit": {
          // Side effects (join + grant) must land before the knocker is told to
          // enter, so the downstream seat/LiveKit checks see the grant.
          await deps.admit(roomId, effect.playerId, effect.asAdmin);
          deps.toPlayer(effect.playerId, "knock-result", { roomId, result: "approved" });
          // The room-scoped admin-changed / room-open-state broadcasts fired
          // before this player joined the channel, so seed their HUD directly
          // with the room's current admin + door state (non-admins only — the
          // fresh admin receives the admin-changed broadcast below).
          if (!effect.asAdmin && state.admin !== null) {
            deps.toPlayer(effect.playerId, "admin-changed", {
              roomId,
              admin: named(state.admin),
              reason: "initial",
            });
          }
          deps.toPlayer(effect.playerId, "room-open-state", {
            roomId,
            allowAll: state.allowAll,
            atCapacity: state.occupants.length >= ctx.capacity,
          });
          break;
        }
        case "admin-changed":
          deps.toRoom(roomId, "admin-changed", {
            roomId,
            admin: effect.admin ? named(effect.admin) : null,
            reason: effect.reason,
          });
          break;
        case "knocks-changed":
          deps.toRoom(roomId, "knock-pending", { roomId, knocks: effect.knocks.map(named) });
          break;
        case "knock-registered":
          clearKnockTimer(room, effect.playerId);
          room.knockTimers.set(
            effect.playerId,
            setTimeout(() => dispatch(roomId, { type: "knock-timeout", playerId: effect.playerId }), deps.knockTimeoutMs),
          );
          break;
        case "knock-resolved":
          clearKnockTimer(room, effect.playerId);
          // `canceled` is client-initiated — the knocker already knows.
          if (effect.result !== "canceled") {
            deps.toPlayer(effect.playerId, "knock-result", { roomId, result: effect.result });
          }
          break;
        case "room-open-state":
          deps.toSpace(ctx.spaceId, "room-open-state", {
            roomId,
            allowAll: effect.allowAll,
            atCapacity: effect.atCapacity,
          });
          break;
        case "capacity-alert":
          deps.toPlayer(effect.playerId, "capacity-alert", { roomId });
          break;
      }
    }

    deps.persist(roomId, snapshotOf(room.state));
  };

  const dispatch = (roomId: string, event: RoomAdminEvent): void => {
    let room = rooms.get(roomId);
    if (!room) {
      room = { state: EMPTY_ROOM, knockTimers: new Map(), queue: Promise.resolve(), pending: 0 };
      rooms.set(roomId, room);
    }
    const current = room;
    current.pending += 1;
    current.queue = current.queue
      .then(() => apply(roomId, current, event))
      .catch((error: unknown) => {
        deps.log.error({ err: error, roomId, event }, "room-admin dispatch failed");
      })
      .finally(() => {
        current.pending -= 1;
        // Drop a fully-settled empty room so the map never leaks. Never drop
        // mid-queue (a queued dispatch still holds this object) or while a knock
        // timer is armed (its firing must find the room's state).
        if (
          current.pending === 0 &&
          current.knockTimers.size === 0 &&
          current.state.admin === null &&
          current.state.occupants.length === 0
        ) {
          rooms.delete(roomId);
        }
      });
  };

  const settle = async (): Promise<void> => {
    await Promise.all([...rooms.values()].map((room) => room.queue));
  };

  return { dispatch, settle };
}
