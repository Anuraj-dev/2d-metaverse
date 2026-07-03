/**
 * Socket.IO wire contract: one zod schema per event payload (client → server and
 * server → client), the inferred TypeScript payload types, and the Socket.IO event
 * maps built from them.
 *
 * The backend `safeParse`s the client → server schemas exactly as before; the
 * server → client schemas exist so both sides — and the contract fixtures — agree
 * on outbound shapes too. The JWT travels in the Socket.IO handshake
 * (`auth: { token }`), never in `join`.
 */
import { z } from "zod";
import { CHAT_SCOPES, DIRS, LIMITS, MEETING_CANCEL_REASONS, ROOM_ENTER_REASONS } from "./constants.js";

/* ------------------------------- primitives ------------------------------- */

export const dirSchema = z.enum(DIRS);
export type Dir = z.infer<typeof dirSchema>;

export const chatScopeSchema = z.enum(CHAT_SCOPES);
export type ChatScope = z.infer<typeof chatScopeSchema>;

export const playerStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  dir: dirSchema,
});
export type PlayerState = z.infer<typeof playerStateSchema>;

/* --------------------------- handshake / auth ----------------------------- */

/** Validates `socket.handshake.auth`. */
export const socketAuthSchema = z.object({ token: z.string().min(1) });
export type SocketAuth = z.infer<typeof socketAuthSchema>;

/* --------------------------- client → server ------------------------------ */

export const joinSchema = z.object({ spaceId: z.string().min(1).max(LIMITS.spaceIdMax) });
export type JoinPayload = z.infer<typeof joinSchema>;

export const moveSchema = z.object({
  x: z.number().finite().min(0).max(LIMITS.moveCoordMax),
  y: z.number().finite().min(0).max(LIMITS.moveCoordMax),
  dir: dirSchema,
});
export type MovePayload = z.infer<typeof moveSchema>;

export const chatSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.chatTextMax),
  scope: chatScopeSchema.optional(),
});
export type ChatPayload = z.infer<typeof chatSchema>;

export const whisperSchema = z.object({
  to: z.string().min(1).max(LIMITS.playerIdMax),
  text: z.string().trim().min(1).max(LIMITS.whisperTextMax),
});
export type WhisperPayload = z.infer<typeof whisperSchema>;

export const roomEnterSchema = z.object({
  roomId: z.string().min(1).max(LIMITS.roomIdMax),
  key: z.string().min(1).max(LIMITS.roomKeyMax),
});
export type RoomEnterPayload = z.infer<typeof roomEnterSchema>;

export const seatSitSchema = z.object({
  roomId: z.string().min(1).max(LIMITS.roomIdMax),
  seatId: z.number().int().nonnegative(),
});
export type SeatSitPayload = z.infer<typeof seatSitSchema>;

/* --------------------------- server → client ------------------------------ */

export const initSchema = z.object({
  selfId: z.string(),
  players: z.array(playerStateSchema),
});
export type InitPayload = z.infer<typeof initSchema>;

export const playerJoinedSchema = playerStateSchema;
export type PlayerJoinedPayload = z.infer<typeof playerJoinedSchema>;

export const playerMovedSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  dir: dirSchema,
});
export type PlayerMovedPayload = z.infer<typeof playerMovedSchema>;

export const playerLeftSchema = z.object({ id: z.string() });
export type PlayerLeftPayload = z.infer<typeof playerLeftSchema>;

/**
 * Outbound chat line. `scope` is a free-form string (either `"world"` or a room id)
 * — deliberately looser than the inbound {@link chatScopeSchema}.
 */
export const chatMessageSchema = z.object({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  scope: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const whisperMessageSchema = z.object({
  from: z.string(),
  fromName: z.string(),
  to: z.string(),
  toName: z.string(),
  text: z.string(),
});
export type WhisperMessage = z.infer<typeof whisperMessageSchema>;

export const whisperFailSchema = z.object({ name: z.string() });
export type WhisperFailPayload = z.infer<typeof whisperFailSchema>;

export const roomEnterResultSchema = z.object({
  ok: z.boolean(),
  roomId: z.string(),
  reason: z.enum(ROOM_ENTER_REASONS).optional(),
});
export type RoomEnterResultPayload = z.infer<typeof roomEnterResultSchema>;

export const seatUpdateSchema = z.object({
  roomId: z.string(),
  seatId: z.number(),
  playerId: z.string().nullable(),
});
export type SeatUpdatePayload = z.infer<typeof seatUpdateSchema>;

/* ---------------------- server → client: meeting lifecycle ----------------- */
/* These schemas are strict (unknown keys REJECT, not strip): they are new
 * contracts with no legacy payloads to tolerate, so passthrough data is a bug
 * on the wire. (The older schemas above predate this requirement and keep
 * their permissive behavior by design.) */

/**
 * A meeting participant as carried on meeting-lifecycle events. Includes the
 * display name so the meeting grid can render nameplates without a roster
 * lookup (the participant may never have been visible in the world to a
 * latecomer's client).
 */
export const meetingParticipantSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
});
export type MeetingParticipant = z.infer<typeof meetingParticipantSchema>;

/**
 * The cancelable "Meeting starting…" countdown began: every player in the room
 * is seated and there are at least two of them. `durationMs` is the effective
 * server-side countdown length (configurable; see MEETING_COUNTDOWN_MS).
 */
export const meetingCountdownSchema = z.strictObject({
  roomId: z.string(),
  durationMs: z.number().int().positive(),
  participants: z.array(meetingParticipantSchema),
});
export type MeetingCountdownPayload = z.infer<typeof meetingCountdownSchema>;

export const meetingCountdownCanceledSchema = z.strictObject({
  roomId: z.string(),
  reason: z.enum(MEETING_CANCEL_REASONS),
});
export type MeetingCountdownCanceledPayload = z.infer<typeof meetingCountdownCanceledSchema>;

/** The countdown elapsed uncanceled: the meeting is live for `participants`. */
export const meetingStartedSchema = z.strictObject({
  roomId: z.string(),
  participants: z.array(meetingParticipantSchema),
});
export type MeetingStartedPayload = z.infer<typeof meetingStartedSchema>;

/** The last participant left; the meeting no longer exists. */
export const meetingEndedSchema = z.strictObject({ roomId: z.string() });
export type MeetingEndedPayload = z.infer<typeof meetingEndedSchema>;

/**
 * A latecomer sat down mid-meeting and joined in place. Carries the full
 * post-join roster so the latecomer's own client (which never saw
 * `meeting-started`) can render the grid without reconstructing state.
 */
export const meetingParticipantJoinedSchema = z.strictObject({
  roomId: z.string(),
  participant: meetingParticipantSchema,
  participants: z.array(meetingParticipantSchema),
});
export type MeetingParticipantJoinedPayload = z.infer<typeof meetingParticipantJoinedSchema>;

/** A participant stood up (or disconnected past grace) and left the meeting. */
export const meetingParticipantLeftSchema = z.strictObject({
  roomId: z.string(),
  playerId: z.string(),
});
export type MeetingParticipantLeftPayload = z.infer<typeof meetingParticipantLeftSchema>;

/* ------------------------------ event maps -------------------------------- */

/** Socket.IO listener map for events the server receives from a client. */
export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  move: (payload: MovePayload) => void;
  chat: (payload: ChatPayload) => void;
  whisper: (payload: WhisperPayload) => void;
  "room-enter": (payload: RoomEnterPayload) => void;
  "room-leave": () => void;
  "seat-sit": (payload: SeatSitPayload) => void;
  "seat-stand": () => void;
}

/** Socket.IO listener map for events the server sends to a client. */
export interface ServerToClientEvents {
  init: (payload: InitPayload) => void;
  "player-joined": (payload: PlayerJoinedPayload) => void;
  "player-moved": (payload: PlayerMovedPayload) => void;
  "player-left": (payload: PlayerLeftPayload) => void;
  chat: (payload: ChatMessage) => void;
  whisper: (payload: WhisperMessage) => void;
  "whisper-fail": (payload: WhisperFailPayload) => void;
  "room-enter-result": (payload: RoomEnterResultPayload) => void;
  "seat-update": (payload: SeatUpdatePayload) => void;
  "meeting-countdown": (payload: MeetingCountdownPayload) => void;
  "meeting-countdown-canceled": (payload: MeetingCountdownCanceledPayload) => void;
  "meeting-started": (payload: MeetingStartedPayload) => void;
  "meeting-ended": (payload: MeetingEndedPayload) => void;
  "meeting-participant-joined": (payload: MeetingParticipantJoinedPayload) => void;
  "meeting-participant-left": (payload: MeetingParticipantLeftPayload) => void;
}
