/**
 * Pure client-side reducer for the server's meeting-lifecycle events (PRD 10).
 *
 * The meeting-START rules live server-side in the trigger state machine
 * (backend/src/meeting.ts) — this module never re-derives them. It only maps
 * the broadcast events onto what THIS client shows (countdown toast, meeting
 * grid) and does (portal-in / portal-out), given who the local player is.
 *
 * Pure module per the scene-as-glue convention: no Phaser, DOM, or net imports.
 */
import type {
  MeetingCountdownCanceledPayload,
  MeetingCountdownPayload,
  MeetingEndedPayload,
  MeetingParticipant,
  MeetingParticipantJoinedPayload,
  MeetingParticipantLeftPayload,
  MeetingStartedPayload,
} from "@metaverse/shared";

export type MeetingUiState =
  | { status: "none" }
  | { status: "countdown"; roomId: string; durationMs: number; participants: MeetingParticipant[] }
  | { status: "in-meeting"; roomId: string; participants: MeetingParticipant[] };

export type MeetingUiEvent =
  | { type: "meeting-countdown"; payload: MeetingCountdownPayload }
  | { type: "meeting-countdown-canceled"; payload: MeetingCountdownCanceledPayload }
  | { type: "meeting-started"; payload: MeetingStartedPayload }
  | { type: "meeting-ended"; payload: MeetingEndedPayload }
  | { type: "meeting-participant-joined"; payload: MeetingParticipantJoinedPayload }
  | { type: "meeting-participant-left"; payload: MeetingParticipantLeftPayload };

/** What the app shell must do in response (portals run on the media sequencer). */
export type MeetingUiAction = "portal-in" | "portal-out" | "none";

export const MEETING_NONE: MeetingUiState = { status: "none" };

export function meetingUiReduce(
  state: MeetingUiState,
  selfId: string,
  event: MeetingUiEvent,
): { state: MeetingUiState; action: MeetingUiAction } {
  switch (event.type) {
    case "meeting-countdown": {
      // Room-scoped broadcast: everyone in the room is seated when it fires,
      // so the local player is always among the participants.
      if (state.status === "in-meeting") return { state, action: "none" }; // stale/misordered
      const { roomId, durationMs, participants } = event.payload;
      return { state: { status: "countdown", roomId, durationMs, participants }, action: "none" };
    }

    case "meeting-countdown-canceled": {
      if (state.status !== "countdown" || state.roomId !== event.payload.roomId) {
        return { state, action: "none" };
      }
      return { state: MEETING_NONE, action: "none" };
    }

    case "meeting-started": {
      const { roomId, participants } = event.payload;
      if (!participants.some((participant) => participant.id === selfId)) {
        // Not ours (e.g. we are in the room unseated while others meet).
        return { state: state.status === "countdown" ? MEETING_NONE : state, action: "none" };
      }
      return { state: { status: "in-meeting", roomId, participants }, action: "portal-in" };
    }

    case "meeting-participant-joined": {
      const { roomId, participant, participants } = event.payload;
      if (participant.id === selfId) {
        // We are the latecomer: our own solo portal into the running meeting.
        return { state: { status: "in-meeting", roomId, participants }, action: "portal-in" };
      }
      if (state.status === "in-meeting" && state.roomId === roomId) {
        return { state: { ...state, participants }, action: "none" };
      }
      return { state, action: "none" };
    }

    case "meeting-participant-left": {
      const { roomId, playerId } = event.payload;
      if (state.status !== "in-meeting" || state.roomId !== roomId) return { state, action: "none" };
      if (playerId === selfId) {
        // Our own stand/Leave: solo portal-out while the meeting continues.
        return { state: MEETING_NONE, action: "portal-out" };
      }
      return {
        state: {
          ...state,
          participants: state.participants.filter((participant) => participant.id !== playerId),
        },
        action: "none",
      };
    }

    case "meeting-ended": {
      // Defensive: ended while we still think we're in it (missed our own
      // participant-left). The normal last-leaver ordering — participant-left
      // (self) then meeting-ended — lands here with status "none": a no-op.
      if (state.status === "in-meeting" && state.roomId === event.payload.roomId) {
        return { state: MEETING_NONE, action: "portal-out" };
      }
      return { state, action: "none" };
    }
  }
}
