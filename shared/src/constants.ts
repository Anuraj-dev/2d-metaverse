/**
 * Framework-free constants shared by the backend (runtime validation + enforcement)
 * and the frontend (UI limits + event wiring). This module imports nothing — in
 * particular no zod — so consumers can pull event names and limits without dragging
 * the schema/runtime cost into their bundle.
 */

/** Movement / facing directions. Order is significant only as a stable list. */
export const DIRS = ["down", "left", "right", "up"] as const;

/** Chat channel scopes a client may request. */
export const CHAT_SCOPES = ["world", "room"] as const;

/** Reasons a `room-enter` attempt can be rejected. */
export const ROOM_ENTER_REASONS = ["bad-key", "full", "rate-limited"] as const;

/** Client → server socket event names. */
export const CLIENT_EVENTS = {
  join: "join",
  move: "move",
  chat: "chat",
  whisper: "whisper",
  roomEnter: "room-enter",
  roomLeave: "room-leave",
  seatSit: "seat-sit",
  seatStand: "seat-stand",
} as const;

/** Server → client socket event names. */
export const SERVER_EVENTS = {
  init: "init",
  playerJoined: "player-joined",
  playerMoved: "player-moved",
  playerLeft: "player-left",
  chat: "chat",
  whisper: "whisper",
  whisperFail: "whisper-fail",
  roomEnterResult: "room-enter-result",
  seatUpdate: "seat-update",
} as const;

/**
 * Every server → client event name, as a tuple. The frontend net layer subscribes
 * to exactly these, so keeping the list here prevents it from drifting out of sync
 * with the emitters.
 */
export const SERVER_EVENT_NAMES = [
  SERVER_EVENTS.init,
  SERVER_EVENTS.playerJoined,
  SERVER_EVENTS.playerMoved,
  SERVER_EVENTS.playerLeft,
  SERVER_EVENTS.chat,
  SERVER_EVENTS.whisper,
  SERVER_EVENTS.whisperFail,
  SERVER_EVENTS.roomEnterResult,
  SERVER_EVENTS.seatUpdate,
] as const;

/**
 * Size / bound limits enforced by the backend zod schemas and mirrored by the
 * frontend UI (e.g. the chat input cap). Single source of truth so a UI cap and a
 * server cap can never silently diverge.
 */
export const LIMITS = {
  /** Identifiers carried on the wire. */
  spaceIdMax: 64,
  roomIdMax: 64,
  /** Whisper target is a player id. */
  playerIdMax: 64,
  roomKeyMax: 128,
  /** Chat / whisper message body. */
  chatTextMax: 500,
  whisperTextMax: 500,
  /** Server-side sanity ceiling for movement coordinates. */
  moveCoordMax: 100_000,
  /** Credentials. */
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 8,
  passwordMax: 128,
  /** LiveKit token request. */
  roomNameMax: 128,
  presenterKeyMax: 128,
  /** Client error beacon payload caps. */
  clientErrorMessageMax: 2000,
  clientErrorStackMax: 8000,
  clientErrorShaMax: 64,
  clientErrorUrlMax: 500,
  clientErrorUserAgentMax: 300,
  clientErrorContextMax: 200,
} as const;

/** Allowed username characters (lowercase alphanumerics, dash, underscore). */
export const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Rate-limit windows and other timing constants enforced server-side. Kept here so
 * the magic numbers behind the contract's abuse protections live in one place.
 */
export const RATE_LIMITS = {
  /** Whispers per player per window. */
  whisperLimit: 20,
  whisperWindowSeconds: 60,
  /** Wrong room-key attempts per player+room per window. */
  roomKeyAttemptLimit: 5,
  roomKeyAttemptWindowSeconds: 5 * 60,
  /** Auth (signup/signin) REST limiter. */
  authWindowMs: 15 * 60_000,
  authLimit: 40,
  /** Client-error beacon sink limiter (per IP). */
  clientErrorWindowMs: 60_000,
  clientErrorLimit: 10,
  /** Minimum spacing between accepted `move` events from one socket. */
  moveThrottleMs: 40,
} as const;
