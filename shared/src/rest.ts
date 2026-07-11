/**
 * REST wire contract: request-body schemas the backend `safeParse`s, plus the
 * response shapes both sides rely on. Same source of truth as the socket events.
 */
import { z } from "zod";
import { dirSchema } from "./socket.js";
import {
  ACTIVE_SPACE_KINDS,
  ARCADE_GAMES,
  BLOCK_ACK_STATUSES,
  LIMITS,
  PRESENCE_ACTIVITY_KINDS,
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

/**
 * `POST /api/v1/blocks` body (PRD 25.13): persistently block another player. The
 * client supplies only the target's player id; the blocker is bound server-side
 * from the authenticated session (a client can never block on someone's behalf).
 * The same shape is reused for `DELETE /api/v1/blocks` (unblock).
 */
export const blockCreateSchema = z.strictObject({
  targetId: z.string().min(1).max(LIMITS.playerIdMax),
});
export type BlockCreateRequest = z.infer<typeof blockCreateSchema>;

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

/**
 * Client-ingestible analytics events. Each feature must extend this
 * discriminated union with a bounded schema before it may emit an event.
 * Identity and timestamps are deliberately absent: the server owns both.
 */
export const analyticsClientEventSchema = z.discriminatedUnion("name", [
  // Foundation-only production verification seam. Product feature events are
  // added by their owning slices with bounded, privacy-reviewed properties.
  z.strictObject({
    name: z.literal("ingestion-probe"),
    properties: z.strictObject({ nonce: z.uuid() }),
  }),
  // Social arrival (PRD 25.26): the arrival surface was shown with live presence.
  // Bounded counts only — no student identities, names, positions, or space ids,
  // so the pilot can measure "did arrival feel populated?" without tracking who.
  z.strictObject({
    name: z.literal("social-arrival-viewed"),
    properties: z.strictObject({
      onlineCount: z.number().int().min(0).max(LIMITS.presenceMaxPeople),
      activeSpaces: z.number().int().min(0).max(LIMITS.presenceMaxSpaces),
      hasSchedule: z.boolean(),
    }),
  }),
  // The student used a truthful locate/view action (not a join). Only the kind of
  // target is recorded — never the target's identity or the specific space.
  z.strictObject({
    name: z.literal("presence-locate"),
    properties: z.strictObject({
      targetKind: z.enum(PRESENCE_ACTIVITY_KINDS),
    }),
  }),
]);
export type AnalyticsClientEvent = z.infer<typeof analyticsClientEventSchema>;

/** `POST /api/v1/analytics/events` body. */
export const analyticsIngestRequestSchema = z.strictObject({
  eventId: z.uuid(),
  event: analyticsClientEventSchema,
});
export type AnalyticsIngestRequest = z.infer<typeof analyticsIngestRequestSchema>;

export const analyticsIngestResponseSchema = z.strictObject({
  acceptedAt: z.iso.datetime(),
  duplicate: z.boolean(),
});
export type AnalyticsIngestResponse = z.infer<typeof analyticsIngestResponseSchema>;

export const analyticsIngestFailureSchema = z.discriminatedUnion("error", [
  z.strictObject({ error: z.literal("invalid-event") }),
  z.strictObject({ error: z.literal("event-id-conflict") }),
  z.strictObject({
    error: z.literal("rate-limited"),
    retryAfterSeconds: z.number().int().min(1).max(60),
  }),
]);
export type AnalyticsIngestFailure = z.infer<typeof analyticsIngestFailureSchema>;

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
 * One entry in the pilot community schedule (PRD 25.26). The schedule is a
 * versioned, schema-validated configuration deployed with the backend (not a live
 * events platform): operators edit it through a reviewed PR. Each entry carries a
 * destination `activityId` so the arrival surface can point students at it.
 * `startsAt`/`endsAt` are UTC ISO timestamps; invalid or expired configuration
 * fails safely to an empty schedule server-side.
 */
export const pilotScheduleEntrySchema = z
  .strictObject({
    id: z.string().min(1).max(LIMITS.spaceIdMax),
    title: z.string().min(1).max(LIMITS.scheduleTitleMax),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    activityId: z.string().min(1).max(LIMITS.roomNameMax),
    description: z.string().min(1).max(LIMITS.scheduleDescriptionMax).optional(),
  })
  .refine((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt), {
    message: "endsAt must be after startsAt",
  });
export type PilotScheduleEntry = z.infer<typeof pilotScheduleEntrySchema>;

/** The full pilot schedule configuration. */
export const pilotScheduleSchema = z.array(pilotScheduleEntrySchema).max(LIMITS.scheduleMaxEntries);
export type PilotSchedule = z.infer<typeof pilotScheduleSchema>;

/* --------------------------- social-arrival read model -------------------- */

/**
 * One online student in the social-arrival read model (PRD 25.26). `place` is the
 * human label of the space they occupy (room/meeting/board/stage), or null when
 * free-roaming the open campus. Identity (`id`/`name`) is already visible in-world
 * for spatial safety, so it is carried here too — but nothing beyond the
 * authoritative activity is exposed.
 */
export const presencePersonSchema = z.strictObject({
  id: z.string().max(LIMITS.playerIdMax),
  name: z.string().max(LIMITS.usernameMax),
  activity: z.enum(PRESENCE_ACTIVITY_KINDS),
  place: z.string().max(LIMITS.presencePlaceLabelMax).nullable(),
});
export type PresencePerson = z.infer<typeof presencePersonSchema>;

/**
 * One active/joinable space (never the open world): a private room, a live
 * meeting, a board table with a match, or the stage gathering — with how many
 * students are there right now.
 */
export const activeSpaceSchema = z.strictObject({
  kind: z.enum(ACTIVE_SPACE_KINDS),
  id: z.string().max(LIMITS.roomNameMax),
  label: z.string().max(LIMITS.presencePlaceLabelMax),
  count: z.number().int().min(0).max(LIMITS.presenceMaxPeople),
});
export type ActiveSpace = z.infer<typeof activeSpaceSchema>;

/**
 * Server-owned snapshot of who is online and what they are doing in a space,
 * broadcast to that space's channel so arriving students see a populated campus.
 * Read-only: it powers truthful locate/view actions, never a join mutation.
 */
export const presenceSnapshotSchema = z.strictObject({
  spaceId: z.string().max(LIMITS.spaceIdMax),
  people: z.array(presencePersonSchema).max(LIMITS.presenceMaxPeople),
  activeSpaces: z.array(activeSpaceSchema).max(LIMITS.presenceMaxSpaces),
  nextScheduled: pilotScheduleEntrySchema.nullable(),
});
export type PresenceSnapshot = z.infer<typeof presenceSnapshotSchema>;

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

/**
 * `POST`/`DELETE /api/v1/blocks` success response (PRD 25.13): a visible,
 * idempotent acknowledgement of the requested transition (see `BLOCK_ACK_STATUSES`).
 */
export const blockAckSchema = z.strictObject({
  status: z.enum(BLOCK_ACK_STATUSES),
});
export type BlockAck = z.infer<typeof blockAckSchema>;

/**
 * `GET /api/v1/blocks` response (PRD 25.13): the requesting player's own block
 * list — the ids they have blocked. The client loads this on connect to mute the
 * blocked users' media/speaking locally; server-side delivery filtering does the
 * symmetric, authoritative work regardless of what the client holds.
 */
export const blockListSchema = z.strictObject({
  blocked: z.array(z.string().min(1).max(LIMITS.playerIdMax)),
});
export type BlockList = z.infer<typeof blockListSchema>;

/**
 * Bounded failure response for the block endpoints (PRD 25.13). Deliberately
 * coarse — it never reflects the target's presence or server internals.
 */
export const blockFailureResponseSchema = z.discriminatedUnion("error", [
  z.strictObject({ error: z.literal("validation") }),
  z.strictObject({ error: z.literal("cannot-block-self") }),
  z.strictObject({ error: z.literal("unauthorized") }),
  z.strictObject({
    error: z.literal("rate-limited"),
    retryAfterSeconds: z.number().int().min(1).max(Math.ceil(RATE_LIMITS.blockWindowMs / 1000)),
  }),
]);
export type BlockFailureResponse = z.infer<typeof blockFailureResponseSchema>;

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
