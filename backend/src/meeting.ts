/**
 * Meeting-start trigger state machine — THE single place the meeting-start
 * rules live (referenced from CLAUDE.md). Pure: plain values in, plain values
 * out; no io, no Redis, no timers. The socket layer owns the side effects
 * (the 3s timer, room-scoped broadcasts) and feeds events + a post-event
 * room snapshot through {@link meetingTransition}.
 *
 * Rules (PRD 10):
 *   - A meeting starts when EVERY player in the room zone is seated AND the
 *     seated count is >= 2 (a solo sitter keeps today's behavior — no portal).
 *   - Reaching that state arms a cancelable countdown; it cancels if anyone
 *     stands or enters the room unseated (and re-arms when the predicate holds
 *     again). It also cancels if a departure breaks the predicate.
 *   - When the countdown elapses, the meeting starts with the seated roster.
 *   - A latecomer who sits mid-meeting joins in place; a participant who
 *     stands (or leaves past disconnect grace) exits alone; the last leaver
 *     ends the meeting.
 */
import type { MEETING_CANCEL_REASONS } from "@metaverse/shared";

export type MeetingCancelReason = (typeof MEETING_CANCEL_REASONS)[number];

/**
 * A room's derived occupancy at the moment just AFTER an event applied.
 * `occupants` = players whose socket is in the room channel (the room zone);
 * `seated` = players holding one of the room's seats. A seated player whose
 * socket dropped inside the reconnect grace window appears in `seated` but
 * not `occupants` — the predicate tolerates that on purpose.
 */
export interface RoomMeetingSnapshot {
  occupants: readonly string[];
  seated: readonly string[];
}

export type MeetingState =
  | { phase: "idle" }
  | { phase: "countdown" }
  | { phase: "active"; participants: readonly string[] };

export type MeetingEvent =
  | { type: "sit"; playerId: string }
  | { type: "stand"; playerId: string }
  | { type: "enter"; playerId: string }
  | { type: "leave"; playerId: string }
  | { type: "countdown-elapsed" };

export type MeetingEffect =
  | { type: "countdown-started" }
  | { type: "countdown-canceled"; reason: MeetingCancelReason }
  | { type: "meeting-started"; participants: readonly string[] }
  | { type: "participant-joined"; playerId: string }
  | { type: "participant-left"; playerId: string }
  | { type: "meeting-ended" };

export interface MeetingTransitionResult {
  state: MeetingState;
  effects: MeetingEffect[];
}

export const IDLE_MEETING: MeetingState = { phase: "idle" };

/** Every player in the room zone is seated, and at least two seats are taken. */
export function allSeated(snapshot: RoomMeetingSnapshot): boolean {
  const seated = new Set(snapshot.seated);
  return snapshot.seated.length >= 2 && snapshot.occupants.every((playerId) => seated.has(playerId));
}

const stay = (state: MeetingState): MeetingTransitionResult => ({ state, effects: [] });

export function meetingTransition(
  state: MeetingState,
  event: MeetingEvent,
  snapshot: RoomMeetingSnapshot,
): MeetingTransitionResult {
  switch (state.phase) {
    case "idle": {
      // Any occupancy change can complete the all-seated picture: a sit, or an
      // unseated observer walking out over a fully seated room.
      if (event.type !== "countdown-elapsed" && allSeated(snapshot)) {
        return { state: { phase: "countdown" }, effects: [{ type: "countdown-started" }] };
      }
      return stay(state);
    }

    case "countdown": {
      switch (event.type) {
        case "stand":
          return { state: IDLE_MEETING, effects: [{ type: "countdown-canceled", reason: "stand" }] };
        case "enter":
          return { state: IDLE_MEETING, effects: [{ type: "countdown-canceled", reason: "unseated-entry" }] };
        case "leave":
          if (allSeated(snapshot)) return stay(state);
          return { state: IDLE_MEETING, effects: [{ type: "countdown-canceled", reason: "leave" }] };
        case "sit":
          // Redundant while already all-seated; never restarts the timer.
          return stay(state);
        case "countdown-elapsed": {
          // Defensive: the wiring cancels the timer on every cancel effect, so
          // the predicate should hold here — but the machine stays total.
          if (!allSeated(snapshot)) {
            return { state: IDLE_MEETING, effects: [{ type: "countdown-canceled", reason: "leave" }] };
          }
          const participants = [...snapshot.seated];
          return { state: { phase: "active", participants }, effects: [{ type: "meeting-started", participants }] };
        }
      }
      // Exhaustive over event.type; unreachable.
      return stay(state);
    }

    case "active": {
      switch (event.type) {
        case "sit": {
          if (state.participants.includes(event.playerId)) return stay(state); // seat switch
          return {
            state: { phase: "active", participants: [...state.participants, event.playerId] },
            effects: [{ type: "participant-joined", playerId: event.playerId }],
          };
        }
        case "stand":
        case "leave": {
          if (!state.participants.includes(event.playerId)) return stay(state);
          const participants = state.participants.filter((playerId) => playerId !== event.playerId);
          const effects: MeetingEffect[] = [{ type: "participant-left", playerId: event.playerId }];
          if (participants.length === 0) {
            effects.push({ type: "meeting-ended" });
            return { state: IDLE_MEETING, effects };
          }
          return { state: { phase: "active", participants }, effects };
        }
        case "enter":
        case "countdown-elapsed":
          return stay(state);
      }
      // Exhaustive over event.type; unreachable.
      return stay(state);
    }
  }
}
