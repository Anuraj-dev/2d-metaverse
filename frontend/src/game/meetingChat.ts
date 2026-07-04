/**
 * Pure client-side reducer for the in-meeting chat transcript (PRD 10).
 *
 * The server owns scoping/relay (backend/src/meeting-manager.ts): a line only
 * reaches this reducer if the server already decided the local player is a
 * meeting participant. This module holds no rules — it just appends the relayed
 * line to the transcript, stamps a stable React key, flags the local player's
 * own lines, and caps the retained history (a meeting is ephemeral; older lines
 * scroll off). Reset to EMPTY_MEETING_CHAT when the meeting ends — no history
 * carries into the next one.
 *
 * Pure module per the scene-as-glue convention: no Phaser, DOM, or net imports.
 */
import type { MeetingChatMessage } from "@metaverse/shared";

export interface MeetingChatLine {
  /** Stable React key, monotonic within one meeting's transcript. */
  key: number;
  /** The sender's player id. */
  senderId: string;
  /** The sender's display name. */
  name: string;
  text: string;
  /** True when the local player sent this line. */
  self: boolean;
}

export interface MeetingChatState {
  lines: readonly MeetingChatLine[];
  /** Next key to assign; also the count of lines ever appended this meeting. */
  nextKey: number;
}

/** Cap on retained transcript lines — oldest fall off past this. */
export const MEETING_CHAT_MAX_LINES = 100;

export const EMPTY_MEETING_CHAT: MeetingChatState = { lines: [], nextKey: 0 };

/** Append one relayed line, flagging the local player's own and capping history. */
export function appendMeetingChat(
  state: MeetingChatState,
  message: MeetingChatMessage,
  selfId: string,
): MeetingChatState {
  const line: MeetingChatLine = {
    key: state.nextKey,
    senderId: message.id,
    name: message.name,
    text: message.text,
    self: message.id === selfId,
  };
  const appended = [...state.lines, line];
  const lines =
    appended.length > MEETING_CHAT_MAX_LINES
      ? appended.slice(appended.length - MEETING_CHAT_MAX_LINES)
      : appended;
  return { lines, nextKey: state.nextKey + 1 };
}
