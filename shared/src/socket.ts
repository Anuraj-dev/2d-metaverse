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
import {
  ADMIN_CHANGE_REASONS,
  BOARD_END_REASONS,
  BOARD_MATCH_PHASES,
  BOARD_MOVE_REJECTIONS,
  BOARD_TABLE_IDS,
  CHAT_COOLDOWN_SCOPES,
  CHAT_SCOPES,
  DIRS,
  KNOCK_RESULTS,
  LIMITS,
  MEETING_CANCEL_REASONS,
} from "./constants.js";
import { BOARD_GAMES } from "./games/board.js";

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

/* --------------------- client → server: room access (PRD 14) --------------- */
/* Passwords are gone: entry is admin + knock/approve. These strict schemas guard
 * the wire; the authoritative rules live in the backend room-access machine. */

const roomIdSchema = z.string().min(1).max(LIMITS.roomIdMax);

/** Knock at a private room's door, asking to be admitted. */
export const knockSchema = z.strictObject({ roomId: roomIdSchema });
export type KnockPayload = z.infer<typeof knockSchema>;

/** Withdraw your own pending knock. */
export const cancelKnockSchema = z.strictObject({ roomId: roomIdSchema });
export type CancelKnockPayload = z.infer<typeof cancelKnockSchema>;

/** Admin: approve a specific pending knocker into the room. */
export const approveKnockSchema = z.strictObject({
  roomId: roomIdSchema,
  playerId: z.string().min(1).max(LIMITS.playerIdMax),
});
export type ApproveKnockPayload = z.infer<typeof approveKnockSchema>;

/** Admin: deny a specific pending knocker. Same shape as approve. */
export const denyKnockSchema = approveKnockSchema;
export type DenyKnockPayload = z.infer<typeof denyKnockSchema>;

/** Admin: toggle the room's allow-all (open door) mode. */
export const toggleAllowAllSchema = z.strictObject({
  roomId: roomIdSchema,
  allowAll: z.boolean(),
});
export type ToggleAllowAllPayload = z.infer<typeof toggleAllowAllSchema>;

export const seatSitSchema = z.object({
  roomId: z.string().min(1).max(LIMITS.roomIdMax),
  seatId: z.number().int().nonnegative(),
});
export type SeatSitPayload = z.infer<typeof seatSitSchema>;

/**
 * A line typed into the in-meeting chat (PRD 10). The server derives the target
 * meeting from the sender's current room + live participant set — the client
 * only supplies text, so there is no roomId to spoof. Reuses the shared chat
 * length cap. Strict: this is a new contract with no legacy shape to tolerate.
 */
export const meetingChatSchema = z.strictObject({
  text: z.string().trim().min(1).max(LIMITS.chatTextMax),
});
export type MeetingChatPayload = z.infer<typeof meetingChatSchema>;

/* ----------------------- client → server: board games ---------------------- */
/* Strict contracts (new; no legacy payloads). The board rules themselves live in
 * `@metaverse/shared` games modules — these schemas only guard the wire. */

const boardTableIdSchema = z.enum(BOARD_TABLE_IDS);
const boardSeatIndexSchema = z.number().int().min(0).max(LIMITS.boardSeatMax);

/** Sit down at seat 0 or 1 of a board table. */
export const boardSitSchema = z.strictObject({
  tableId: boardTableIdSchema,
  seat: boardSeatIndexSchema,
});
export type BoardSitPayload = z.infer<typeof boardSitSchema>;

/** Accept the pending match offer at a table (both seats must accept to start). */
export const boardAcceptSchema = z.strictObject({ tableId: boardTableIdSchema });
export type BoardAcceptPayload = z.infer<typeof boardAcceptSchema>;

/** Play a move: a cell index (tic-tac-toe) or column (Connect-4). */
export const boardMoveSchema = z.strictObject({
  tableId: boardTableIdSchema,
  index: z.number().int().min(0).max(LIMITS.boardMoveIndexMax),
});
export type BoardMovePayload = z.infer<typeof boardMoveSchema>;

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
  /** Author's player id (server-stamped, not client-supplied). */
  id: z.string(),
  name: z.string(),
  text: z.string(),
  scope: z.string(),
  /**
   * Server-generated unique id for this line (PRD 25.12). Stable across every
   * recipient, so a report can reference exactly one message and the server can
   * bind its authoritative author/text — the client can never forge it.
   */
  messageId: z.string(),
  /** Server send timestamp (epoch ms). */
  ts: z.number().int().nonnegative(),
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

/**
 * A refused chat send: the sender exceeded their per-player rate window (PRD
 * 25.11). Sent only to the offending client so the right surface (`scope`) can
 * show retry timing instead of the message vanishing silently. `retryAfterMs` is
 * the server's estimate of when the next send will be accepted (the remaining
 * window). Applies uniformly to world/room chat, whispers, and meeting chat.
 */
export const chatCooldownSchema = z.strictObject({
  scope: z.enum(CHAT_COOLDOWN_SCOPES),
  retryAfterMs: z.number().int().nonnegative(),
});
export type ChatCooldownPayload = z.infer<typeof chatCooldownSchema>;

/* --------------------- server → client: room access (PRD 14) --------------- */
/* Strict contracts (unknown keys REJECT): new payloads with no legacy shapes. */

/** A pending knocker, shown to the admin in the approve/deny toast. */
export const knockRequesterSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
});
export type KnockRequester = z.infer<typeof knockRequesterSchema>;

/**
 * The room's current pending-knock queue, broadcast to occupants on every
 * change. Only the admin's client renders the approve/deny prompts; a cancel or
 * timeout simply shrinks the list.
 */
export const knockPendingSchema = z.strictObject({
  roomId: z.string(),
  knocks: z.array(knockRequesterSchema),
});
export type KnockPendingPayload = z.infer<typeof knockPendingSchema>;

/** The terminal outcome of THIS client's knock, sent only to the knocker. */
export const knockResultSchema = z.strictObject({
  roomId: z.string(),
  result: z.enum(KNOCK_RESULTS),
});
export type KnockResultPayload = z.infer<typeof knockResultSchema>;

/**
 * Who holds the room's admin now, broadcast to occupants (badge + "you are the
 * admin" notice). `admin` is null once the room empties.
 */
export const adminChangedSchema = z.strictObject({
  roomId: z.string(),
  admin: knockRequesterSchema.nullable(),
  reason: z.enum(ADMIN_CHANGE_REASONS),
});
export type AdminChangedPayload = z.infer<typeof adminChangedSchema>;

/**
 * The room's door visibility, broadcast space-wide so players near the door see
 * it disappear in allow-all mode and reappear at capacity. The door is hidden
 * (walk-in) iff `allowAll && !atCapacity`.
 */
export const roomOpenStateSchema = z.strictObject({
  roomId: z.string(),
  allowAll: z.boolean(),
  atCapacity: z.boolean(),
});
export type RoomOpenStatePayload = z.infer<typeof roomOpenStateSchema>;

/** Sent to a player turned away because the room is at max capacity. */
export const capacityAlertSchema = z.strictObject({ roomId: z.string() });
export type CapacityAlertPayload = z.infer<typeof capacityAlertSchema>;

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

/**
 * One in-meeting chat line relayed to the meeting's participants only (PRD 10).
 * Delivered per-socket to the live participant set (never the room channel), so
 * unseated spectators in the same room never receive it. `id` is the sender's
 * player id (drives the local "you" styling); the message is echoed to the
 * sender too, so their own line arrives on the same path.
 */
export const meetingChatMessageSchema = z.strictObject({
  roomId: z.string(),
  id: z.string(),
  name: z.string(),
  text: z.string(),
});
export type MeetingChatMessage = z.infer<typeof meetingChatMessageSchema>;

/* ---------------------- server → client: board games ----------------------- */
/* The authoritative match snapshot the server broadcasts on every transition
 * (seat change, offer, accept, move, forfeit, end). Mirrors the pure `BoardState`
 * value type in the games modules so a validated state travels unchanged. */

/** A board cell: 0 empty, 1 seat-0 player, 2 seat-1 player. */
export const boardCellSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
/** A player mark (seat 0 → 1, seat 1 → 2). */
export const boardPlayerSchema = z.union([z.literal(1), z.literal(2)]);

export const boardResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("in_progress") }),
  z.strictObject({ status: z.literal("won"), winner: boardPlayerSchema, line: z.array(z.number().int()) }),
  z.strictObject({ status: z.literal("draw") }),
]);
export type BoardResultWire = z.infer<typeof boardResultSchema>;

/** The serialized game state (board, turn, result) that drives rendering. */
export const boardGameStateSchema = z.strictObject({
  board: z.array(boardCellSchema),
  turn: boardPlayerSchema,
  result: boardResultSchema,
});
export type BoardGameStateWire = z.infer<typeof boardGameStateSchema>;

/** A seat occupant. `accepted` is meaningful only during the offer phase. */
export const boardOccupantSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  accepted: z.boolean(),
});
export type BoardOccupant = z.infer<typeof boardOccupantSchema>;

/**
 * Full authoritative snapshot of a table, broadcast space-wide on every change
 * so seated players and passing spectators render the same board. `state` is
 * null until a match starts; `reason` is set only once the match is over.
 */
export const boardUpdateSchema = z.strictObject({
  tableId: boardTableIdSchema,
  game: z.enum(BOARD_GAMES),
  phase: z.enum(BOARD_MATCH_PHASES),
  seats: z.tuple([boardOccupantSchema.nullable(), boardOccupantSchema.nullable()]),
  state: boardGameStateSchema.nullable(),
  reason: z.enum(BOARD_END_REASONS).nullable(),
});
export type BoardUpdatePayload = z.infer<typeof boardUpdateSchema>;

/** A rejected board action, sent only to the offending client. */
export const boardErrorSchema = z.strictObject({
  tableId: boardTableIdSchema,
  reason: z.enum(BOARD_MOVE_REJECTIONS),
});
export type BoardErrorPayload = z.infer<typeof boardErrorSchema>;

/* ------------------------------ event maps -------------------------------- */

/** Socket.IO listener map for events the server receives from a client. */
export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  move: (payload: MovePayload) => void;
  chat: (payload: ChatPayload) => void;
  whisper: (payload: WhisperPayload) => void;
  knock: (payload: KnockPayload) => void;
  "cancel-knock": (payload: CancelKnockPayload) => void;
  "approve-knock": (payload: ApproveKnockPayload) => void;
  "deny-knock": (payload: DenyKnockPayload) => void;
  "toggle-allow-all": (payload: ToggleAllowAllPayload) => void;
  "room-leave": () => void;
  "seat-sit": (payload: SeatSitPayload) => void;
  "seat-stand": () => void;
  "meeting-chat": (payload: MeetingChatPayload) => void;
  "board-sit": (payload: BoardSitPayload) => void;
  "board-stand": () => void;
  "board-accept": (payload: BoardAcceptPayload) => void;
  "board-move": (payload: BoardMovePayload) => void;
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
  "chat-cooldown": (payload: ChatCooldownPayload) => void;
  "knock-pending": (payload: KnockPendingPayload) => void;
  "knock-result": (payload: KnockResultPayload) => void;
  "admin-changed": (payload: AdminChangedPayload) => void;
  "room-open-state": (payload: RoomOpenStatePayload) => void;
  "capacity-alert": (payload: CapacityAlertPayload) => void;
  "seat-update": (payload: SeatUpdatePayload) => void;
  "meeting-countdown": (payload: MeetingCountdownPayload) => void;
  "meeting-countdown-canceled": (payload: MeetingCountdownCanceledPayload) => void;
  "meeting-started": (payload: MeetingStartedPayload) => void;
  "meeting-ended": (payload: MeetingEndedPayload) => void;
  "meeting-participant-joined": (payload: MeetingParticipantJoinedPayload) => void;
  "meeting-participant-left": (payload: MeetingParticipantLeftPayload) => void;
  "meeting-chat": (payload: MeetingChatMessage) => void;
  "board-update": (payload: BoardUpdatePayload) => void;
  "board-error": (payload: BoardErrorPayload) => void;
}
