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
  /**
   * Whether an in-meeting chat line from `senderId` may reach `recipientId`
   * (PRD 25.13). Returns false for a blocked pair in either direction so the
   * line is silently withheld from that recipient. Defaults to always-deliver.
   */
  canDeliver?: (senderId: string, recipientId: string) => boolean;
  log: Logger;
}

export interface MeetingManager {
  /** Feed a room-occupancy event; effects broadcast asynchronously. */
  dispatch: (roomId: string, event: MeetingEvent) => void;
  /**
   * Relay an in-meeting chat line (PRD 10). No-op unless the room's meeting is
   * live AND the sender is a current participant; delivered per-socket to the
   * participant set only (the sender included, so their own line echoes back).
   * Rides the room's serialized queue, so the gate always sees post-transition
   * state — a chat racing a queued stand/leave can never use a stale roster.
   */
  chat: (roomId: string, senderId: string, text: string) => void;
  /** Await all in-flight dispatches (test synchronization only). */
  settle: () => Promise<void>;
  /**
   * Room ids with a live (started) meeting right now — read by the social-arrival
   * read model (PRD 25.26) to distinguish "meeting" from a merely-occupied "room".
   */
  activeMeetingRooms: () => string[];
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

  /** Chain a task onto the room's serialized queue (shared by dispatch + chat). */
  const enqueue = (
    roomId: string,
    room: RoomMeeting,
    task: () => Promise<void> | void,
    onError: (error: unknown) => void,
  ): void => {
    room.pending += 1;
    room.queue = room.queue
      .then(task)
      .catch(onError)
      .finally(() => {
        room.pending -= 1;
        // Drop fully settled idle rooms so the map never leaks across a
        // long-lived process. Never drop mid-queue: a queued task still
        // holds this room object, and splitting state across two objects
        // would fork the machine.
        if (room.pending === 0 && room.state.phase === "idle" && !room.timer) {
          rooms.delete(roomId);
        }
      });
  };

  const dispatch = (roomId: string, event: MeetingEvent): void => {
    let room = rooms.get(roomId);
    if (!room) {
      room = { state: IDLE_MEETING, queue: Promise.resolve(), pending: 0 };
      rooms.set(roomId, room);
    }
    const current = room;
    enqueue(
      roomId,
      current,
      () => apply(roomId, current, event),
      (error) => deps.log.error({ err: error, roomId, event }, "meeting dispatch failed"),
    );
  };

  const chat = (roomId: string, senderId: string, text: string): void => {
    const room = rooms.get(roomId);
    // No tracked room means no live meeting and no queued transition that
    // could still start one — drop the line without touching the queue.
    if (!room) return;
    // State transitions are applied asynchronously on the room queue, so the
    // gate must run AFTER any already-dispatched stand/leave/sit has applied:
    // checking room.state synchronously here would fan out from a stale
    // participant set (e.g. one last line landing after the sender left).
    enqueue(
      roomId,
      room,
      () => {
        const state = room.state;
        // Gate on the authoritative live participant set: only a seated
        // participant of a running meeting may speak, and only participants
        // receive the line.
        if (state.phase !== "active" || !state.participants.includes(senderId)) return;
        const message = { roomId, id: senderId, name: deps.resolveName(senderId), text };
        for (const participantId of state.participants) {
          // Withhold from a blocked pair (either direction) — the sender still
          // gets their own echo (canDeliver(x, x) is always true).
          if (deps.canDeliver && !deps.canDeliver(senderId, participantId)) continue;
          deps.sendToPlayer(participantId, "meeting-chat", message);
        }
      },
      (error) => deps.log.error({ err: error, roomId, senderId }, "meeting chat relay failed"),
    );
  };

  const settle = async (): Promise<void> => {
    await Promise.all([...rooms.values()].map((room) => room.queue));
  };

  const activeMeetingRooms = (): string[] =>
    [...rooms.entries()].filter(([, room]) => room.state.phase === "active").map(([roomId]) => roomId);

  return { dispatch, chat, settle, activeMeetingRooms };
}
