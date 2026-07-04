/**
 * Side-effect shell around the pure meeting trigger machine (meeting.ts).
 * Owns per-room machine state, the cancelable countdown timer, and the
 * translation of machine effects into room-scoped socket broadcasts.
 *
 * Dependencies are injected (snapshot reader, name resolver, broadcaster) so
 * the manager itself stays unit-testable without Socket.IO or Redis; the
 * socket layer provides the real implementations.
 *
 * Dispatches are serialized per room: each event awaits a fresh post-event
 * snapshot, so two racing sits cannot interleave their transitions.
 */
import type { MeetingParticipant, ServerToClientEvents } from "@metaverse/shared";
import {
  IDLE_MEETING,
  meetingTransition,
  type MeetingEvent,
  type MeetingState,
  type RoomMeetingSnapshot,
} from "./meeting.js";
import type { Logger } from "pino";

type MeetingBroadcast = <E extends keyof ServerToClientEvents>(
  roomId: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) => void;

/** Deliver one event to a single participant's socket (per-player, not room-wide). */
type MeetingSendToPlayer = <E extends keyof ServerToClientEvents>(
  playerId: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) => void;

export interface MeetingManagerDeps {
  countdownMs: number;
  getSnapshot: (roomId: string) => Promise<RoomMeetingSnapshot>;
  resolveName: (playerId: string) => string;
  broadcast: MeetingBroadcast;
  /** Per-participant delivery, so in-meeting chat never leaks to spectators. */
  sendToPlayer: MeetingSendToPlayer;
  log: Logger;
}

export interface MeetingManager {
  /** Feed a room-occupancy event; effects broadcast asynchronously. */
  dispatch: (roomId: string, event: MeetingEvent) => void;
  /**
   * Relay an in-meeting chat line (PRD 10). No-op unless the room's meeting is
   * live AND the sender is a current participant; delivered per-socket to the
   * participant set only (the sender included, so their own line echoes back).
   */
  chat: (roomId: string, senderId: string, text: string) => void;
  /** Await all in-flight dispatches (test synchronization only). */
  settle: () => Promise<void>;
}

interface RoomMeeting {
  state: MeetingState;
  timer?: NodeJS.Timeout;
  queue: Promise<void>;
  /** Dispatches queued or running; the room entry may only be dropped at 0. */
  pending: number;
}

export function createMeetingManager(deps: MeetingManagerDeps): MeetingManager {
  const rooms = new Map<string, RoomMeeting>();

  const roster = (participantIds: readonly string[]): MeetingParticipant[] =>
    participantIds.map((id) => ({ id, name: deps.resolveName(id) }));

  const apply = async (roomId: string, room: RoomMeeting, event: MeetingEvent): Promise<void> => {
    const snapshot = await deps.getSnapshot(roomId);
    const { state, effects } = meetingTransition(room.state, event, snapshot);
    room.state = state;
    for (const effect of effects) {
      switch (effect.type) {
        case "countdown-started":
          clearTimeout(room.timer);
          room.timer = setTimeout(() => dispatch(roomId, { type: "countdown-elapsed" }), deps.countdownMs);
          deps.broadcast(roomId, "meeting-countdown", {
            roomId,
            durationMs: deps.countdownMs,
            participants: roster(snapshot.seated),
          });
          break;
        case "countdown-canceled":
          clearTimeout(room.timer);
          delete room.timer;
          deps.broadcast(roomId, "meeting-countdown-canceled", { roomId, reason: effect.reason });
          break;
        case "meeting-started":
          clearTimeout(room.timer);
          delete room.timer;
          deps.log.info({ roomId, participants: effect.participants }, "meeting started");
          deps.broadcast(roomId, "meeting-started", { roomId, participants: roster(effect.participants) });
          break;
        case "participant-joined": {
          const participants = state.phase === "active" ? state.participants : [];
          deps.broadcast(roomId, "meeting-participant-joined", {
            roomId,
            participant: { id: effect.playerId, name: deps.resolveName(effect.playerId) },
            participants: roster(participants),
          });
          break;
        }
        case "participant-left":
          deps.broadcast(roomId, "meeting-participant-left", { roomId, playerId: effect.playerId });
          break;
        case "meeting-ended":
          deps.log.info({ roomId }, "meeting ended");
          deps.broadcast(roomId, "meeting-ended", { roomId });
          break;
      }
    }
  };

  const dispatch = (roomId: string, event: MeetingEvent): void => {
    let room = rooms.get(roomId);
    if (!room) {
      room = { state: IDLE_MEETING, queue: Promise.resolve(), pending: 0 };
      rooms.set(roomId, room);
    }
    const current = room;
    current.pending += 1;
    current.queue = current.queue
      .then(() => apply(roomId, current, event))
      .catch((error: unknown) => {
        deps.log.error({ err: error, roomId, event }, "meeting dispatch failed");
      })
      .finally(() => {
        current.pending -= 1;
        // Drop fully settled idle rooms so the map never leaks across a
        // long-lived process. Never drop mid-queue: a queued dispatch still
        // holds this room object, and splitting state across two objects
        // would fork the machine.
        if (current.pending === 0 && current.state.phase === "idle" && !current.timer) {
          rooms.delete(roomId);
        }
      });
  };

  const chat = (roomId: string, senderId: string, text: string): void => {
    const room = rooms.get(roomId);
    // Gate on the authoritative live participant set: only a seated participant
    // of a running meeting may speak, and only participants receive the line.
    if (!room || room.state.phase !== "active" || !room.state.participants.includes(senderId)) return;
    const message = { roomId, id: senderId, name: deps.resolveName(senderId), text };
    for (const participantId of room.state.participants) {
      deps.sendToPlayer(participantId, "meeting-chat", message);
    }
  };

  const settle = async (): Promise<void> => {
    await Promise.all([...rooms.values()].map((room) => room.queue));
  };

  return { dispatch, chat, settle };
}
