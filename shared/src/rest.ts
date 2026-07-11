/**
 * REST wire contract: request-body schemas the backend `safeParse`s, plus the
 * response shapes both sides rely on. Same source of truth as the socket events.
 */
import { z } from "zod";
import { dirSchema } from "./socket.js";
import {
  ARCADE_GAMES,
  AUTH_TRANSPORT_REASONS,
  LIMITS,
  MEDIA_PUBLISH_REASONS,
  RATE_LIMITS,
  RECONNECT_REASONS,
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

/**
 * `POST /client-errors/operational` body (PRD 25.8): a bounded report of a
 * CAUGHT/handled operational failure (auth-transport, reconnect, media-publish).
 *
 * Privacy discipline is enforced by the schema itself, not by trusting the
 * client: each variant is a `strictObject` (extra keys are rejected, so a
 * report can never smuggle chat/transcripts, credentials, precise coordinates,
 * SDP, or raw device identifiers), and `reason` is a closed enum per category —
 * there is no free-text message or stack field. `sha`/`url`/`userAgent`/
 * `context` reuse the same coarse, capped fields (and caps) as the crash beacon;
 * `url` carries a pathname only and `context` a short allowlisted scene note.
 */
const operationalReportBase = {
  sha: z.string().min(1).max(LIMITS.clientErrorShaMax),
  url: z.string().max(LIMITS.clientErrorUrlMax).optional(),
  userAgent: z.string().max(LIMITS.clientErrorUserAgentMax).optional(),
  context: z.string().max(LIMITS.clientErrorContextMax).optional(),
} as const;
export const operationalReportSchema = z.discriminatedUnion("category", [
  z.strictObject({
    category: z.literal("auth-transport"),
    reason: z.enum(AUTH_TRANSPORT_REASONS),
    ...operationalReportBase,
  }),
  z.strictObject({
    category: z.literal("reconnect"),
    reason: z.enum(RECONNECT_REASONS),
    ...operationalReportBase,
  }),
  z.strictObject({
    category: z.literal("media-publish"),
    reason: z.enum(MEDIA_PUBLISH_REASONS),
    ...operationalReportBase,
  }),
]);
export type OperationalReport = z.infer<typeof operationalReportSchema>;

/** `POST /api/v1/arcade/scores` body: a client-reported score for one cabinet. */
export const arcadeScoreSchema = z.object({
  game: z.enum(ARCADE_GAMES),
  score: z.number().int().min(0).max(LIMITS.arcadeScoreMax),
});
export type ArcadeScoreSubmission = z.infer<typeof arcadeScoreSchema>;

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
