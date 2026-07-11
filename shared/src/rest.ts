/**
 * REST wire contract: request-body schemas the backend `safeParse`s, plus the
 * response shapes both sides rely on. Same source of truth as the socket events.
 */
import { z } from "zod";
import { dirSchema } from "./socket.js";
import {
  ARCADE_GAMES,
  LIMITS,
  RATE_LIMITS,
  REPORT_ACK_STATUSES,
  REPORT_CATEGORIES,
  USERNAME_PATTERN,
} from "./constants.js";

/* ------------------------------- requests --------------------------------- */

/** `POST /api/v1/signup` and `/signin` body. */
export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(LIMITS.usernameMin)
    .max(LIMITS.usernameMax)
    .regex(USERNAME_PATTERN),
  password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax),
});
export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * `POST /api/v1/livekit/token` body. `stagePublish` requests a publish-capable
 * stage token (PRD 17); the backend grants it only when the requester's
 * server-known position is inside the stage zone (no presenter key). Absent /
 * false yields a subscribe-only audience token.
 */
export const liveKitSchema = z.object({
  roomName: z.string().min(1).max(LIMITS.roomNameMax),
  stagePublish: z.boolean().optional(),
});
export type LiveKitTokenRequest = z.infer<typeof liveKitSchema>;

/** `POST /client-errors` body (frontend error beacon). */
export const clientErrorSchema = z.object({
  message: z.string().min(1).max(LIMITS.clientErrorMessageMax),
  stack: z.string().max(LIMITS.clientErrorStackMax).optional(),
  sha: z.string().min(1).max(LIMITS.clientErrorShaMax),
  url: z.string().max(LIMITS.clientErrorUrlMax).optional(),
  userAgent: z.string().max(LIMITS.clientErrorUserAgentMax).optional(),
  context: z.string().max(LIMITS.clientErrorContextMax).optional(),
});
export type ClientErrorReport = z.infer<typeof clientErrorSchema>;

/** `POST /api/v1/arcade/scores` body: a client-reported score for one cabinet. */
export const arcadeScoreSchema = z.object({
  game: z.enum(ARCADE_GAMES),
  score: z.number().int().min(0).max(LIMITS.arcadeScoreMax),
});
export type ArcadeScoreSubmission = z.infer<typeof arcadeScoreSchema>;

/**
 * `POST /api/v1/reports` body (PRD 25.12): flag one broadcast chat line. The
 * client supplies ONLY the server-stamped `messageId`, a reason `category`, and
 * an optional short note. Author, target, and the message text/scope are bound
 * server-side from the message's own snapshot — the reporter can never forge who
 * said what or attach arbitrary transcript context.
 */
export const reportCreateSchema = z.strictObject({
  messageId: z.string().min(1).max(LIMITS.reportMessageIdMax),
  category: z.enum(REPORT_CATEGORIES),
  note: z.string().trim().min(1).max(LIMITS.reportNoteMax).optional(),
});
export type ReportCreateRequest = z.infer<typeof reportCreateSchema>;

/* ------------------------------- responses -------------------------------- */

/**
 * Bounded failure response shared by `POST /signup` and `POST /signin`.
 * Details stay deliberately coarse: the wire never reflects credentials or
 * arbitrary database/server text. Rate limiting is the only variant carrying
 * metadata, capped to the configured auth window.
 */
export const authFailureResponseSchema = z.discriminatedUnion("error", [
  z.strictObject({ error: z.literal("validation") }),
  z.strictObject({ error: z.literal("username-taken") }),
  z.strictObject({ error: z.literal("invalid-credentials") }),
  z.strictObject({
    error: z.literal("rate-limited"),
    retryAfterSeconds: z.number().int().min(1).max(Math.ceil(RATE_LIMITS.authWindowMs / 1000)),
  }),
  z.strictObject({ error: z.literal("server-error") }),
]);
export type AuthFailureResponse = z.infer<typeof authFailureResponseSchema>;

/** One leaderboard row: a player's best on a cabinet. */
export const arcadeScoreEntrySchema = z.object({
  username: z.string(),
  score: z.number().int(),
});
export type ArcadeScoreEntry = z.infer<typeof arcadeScoreEntrySchema>;

/**
 * `GET /api/v1/arcade/scores/:game` and the `POST` success response: the top-N
 * leaderboard for a cabinet plus the requesting player's personal best (null if
 * they have never scored).
 */
export const arcadeLeaderboardSchema = z.object({
  game: z.enum(ARCADE_GAMES),
  top: z.array(arcadeScoreEntrySchema),
  best: z.number().int().nullable(),
});
export type ArcadeLeaderboard = z.infer<typeof arcadeLeaderboardSchema>;

/**
 * `POST /api/v1/reports` success response (PRD 25.12): a visible acknowledgement.
 * `created` recorded a fresh moderation record; `duplicate` means the reporter had
 * already flagged this same message (idempotent — no second record is written).
 */
export const reportAckSchema = z.strictObject({
  status: z.enum(REPORT_ACK_STATUSES),
});
export type ReportAck = z.infer<typeof reportAckSchema>;

/**
 * Bounded failure response for `POST /api/v1/reports`. Deliberately coarse — it
 * never reflects message content, the target's identity, or server internals.
 * `rate-limited` is the only variant carrying metadata (the retry window).
 */
export const reportFailureResponseSchema = z.discriminatedUnion("error", [
  z.strictObject({ error: z.literal("validation") }),
  z.strictObject({ error: z.literal("message-not-found") }),
  z.strictObject({ error: z.literal("cannot-report-self") }),
  z.strictObject({ error: z.literal("unauthorized") }),
  z.strictObject({
    error: z.literal("rate-limited"),
    retryAfterSeconds: z.number().int().min(1).max(Math.ceil(RATE_LIMITS.reportWindowMs / 1000)),
  }),
]);
export type ReportFailureResponse = z.infer<typeof reportFailureResponseSchema>;

/** A private room within a space, as returned by `GET /api/v1/space/:id`. */
export const roomInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  doorZone: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  seats: z.array(
    z.object({
      id: z.number(),
      x: z.number(),
      y: z.number(),
      facing: dirSchema,
    }),
  ),
});
export type RoomInfo = z.infer<typeof roomInfoSchema>;

/** `GET /api/v1/space/:id` response. */
export const spaceInfoSchema = z.object({
  mapJsonUrl: z.string(),
  rooms: z.array(roomInfoSchema),
});
export type SpaceInfo = z.infer<typeof spaceInfoSchema>;

/** `POST /api/v1/signin` success response. */
export const authTokenResponseSchema = z.object({ token: z.string() });
export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>;

/** `POST /api/v1/livekit/token` success response. */
export const liveKitTokenResponseSchema = z.object({
  livekitToken: z.string(),
  url: z.string(),
});
export type LiveKitTokenResponse = z.infer<typeof liveKitTokenResponseSchema>;
