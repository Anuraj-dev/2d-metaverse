import { Router } from "express";
import rateLimit, { type RateLimitInfo } from "express-rate-limit";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { z } from "zod";
import {
  ARCADE_GAMES,
  LIMITS,
  RATE_LIMITS,
  arcadeScoreSchema,
  analyticsIngestRequestSchema,
  blockCreateSchema,
  credentialsSchema,
  liveKitSchema,
  reportCreateSchema,
  type ArcadeGame,
  type ArcadeLeaderboard,
  type BlockAck,
  type BlockList,
  type ReportAck,
} from "@metaverse/shared";
import { issueToken, requireAuth, type AuthenticatedRequest } from "./auth.js";
import { ingestAnalyticsEvent, safelyRecordSigninOutcome } from "./analytics.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { childLogger } from "./logger.js";
import { hashSecret, verifySecret } from "./password.js";
import {
  getArcadeBest,
  getArcadeLeaderboard,
  getRoom,
  getSpace,
  getSuspension,
  insertBlock,
  insertReport,
  removeBlock,
  spaceExists,
  submitArcadeScore,
} from "./repository.js";
import { isSuspended } from "./suspension.js";
import { blocks } from "./block-cache.js";
import { getReportableMessage, redis } from "./redis.js";
import { canPublishFromStage } from "./stage.js";
import { requestLog } from "./request-logger.js";

const analyticsFallbackLog = childLogger({ module: "analytics" });

// Privacy-safe moderation analytics (PRD 25.12): coarse ingestion events only —
// never the message text, the note, or the reporter/target identities.
const moderationLog = childLogger({ module: "moderation" });

// Request schemas live in @metaverse/shared (single source of truth for wire shapes).
export const api = Router();

/** Read a player's last known {x,y} from the space's Redis presence hash. */
async function presencePosition(
  spaceId: string,
  playerId: string,
): Promise<{ x: number; y: number } | null> {
  const raw = await redis.hGet(`presence:${spaceId}`, playerId);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      const { x, y } = value;
      if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
        return { x, y };
      }
    }
  } catch {
    // Malformed presence JSON → treat as unknown position (denies publish).
  }
  return null;
}
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.authWindowMs,
  limit: RATE_LIMITS.authLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (request, response) => {
    const resetTime = (request as typeof request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
    const remainingMs = resetTime ? resetTime.getTime() - Date.now() : RATE_LIMITS.authWindowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.min(Math.ceil(remainingMs / 1000), Math.ceil(RATE_LIMITS.authWindowMs / 1000)),
    );
    if (request.path === "/signin") {
      void safelyRecordSigninOutcome(response, "rate-limited", requestLog(response, analyticsFallbackLog)).then(() => {
        response.status(429).json({ error: "rate-limited", retryAfterSeconds });
      });
      return;
    }
    response.status(429).json({ error: "rate-limited", retryAfterSeconds });
  },
});
const arcadeScoreLimiter = rateLimit({
  windowMs: RATE_LIMITS.arcadeScoreWindowMs,
  limit: RATE_LIMITS.arcadeScoreLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
const analyticsLimiter = rateLimit({
  windowMs: RATE_LIMITS.analyticsWindowMs,
  limit: RATE_LIMITS.analyticsLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (request) => (request as AuthenticatedRequest).user.id,
  handler: (request, response) => {
    const resetTime = (request as typeof request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
    const remainingMs = resetTime ? resetTime.getTime() - Date.now() : RATE_LIMITS.analyticsWindowMs;
    const retryAfterSeconds = Math.max(1, Math.min(Math.ceil(remainingMs / 1000), 60));
    response.status(429).json({ error: "rate-limited", retryAfterSeconds });
  },
});
const arcadeLeaderboardLimiter = rateLimit({
  windowMs: RATE_LIMITS.arcadeLeaderboardWindowMs,
  limit: RATE_LIMITS.arcadeLeaderboardLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
const reportLimiter = rateLimit({
  windowMs: RATE_LIMITS.reportWindowMs,
  limit: RATE_LIMITS.reportLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (request, response) => {
    const resetTime = (request as typeof request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
    const remainingMs = resetTime ? resetTime.getTime() - Date.now() : RATE_LIMITS.reportWindowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.min(Math.ceil(remainingMs / 1000), Math.ceil(RATE_LIMITS.reportWindowMs / 1000)),
    );
    response.status(429).json({ error: "rate-limited", retryAfterSeconds });
  },
});

const blockLimiter = rateLimit({
  windowMs: RATE_LIMITS.blockWindowMs,
  limit: RATE_LIMITS.blockLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (request, response) => {
    const resetTime = (request as typeof request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
    const remainingMs = resetTime ? resetTime.getTime() - Date.now() : RATE_LIMITS.blockWindowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.min(Math.ceil(remainingMs / 1000), Math.ceil(RATE_LIMITS.blockWindowMs / 1000)),
    );
    response.status(429).json({ error: "rate-limited", retryAfterSeconds });
  },
});

function isArcadeGame(value: string): value is ArcadeGame {
  return (ARCADE_GAMES as readonly string[]).includes(value);
}

api.post("/signup", authLimiter, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const passwordHash = await hashSecret(parsed.data.password);
  try {
    await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [parsed.data.username, passwordHash]);
    response.status(200).json({ ok: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "username-taken" });
      return;
    }
    throw error;
  }
});

api.post("/signin", authLimiter, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    await safelyRecordSigninOutcome(response, "validation", requestLog(response, analyticsFallbackLog));
    response.status(400).json({ error: "validation" });
    return;
  }
  const result = await pool.query<{ id: string; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [parsed.data.username]
  );
  const user = result.rows[0];
  if (!user || !(await verifySecret(parsed.data.password, user.password_hash))) {
    await safelyRecordSigninOutcome(response, "invalid-credentials", requestLog(response, analyticsFallbackLog));
    response.status(401).json({ error: "invalid-credentials" });
    return;
  }
  // Suspension gate (PRD 25.14): a suspended user is denied a fresh token. Bounded
  // failure — only the expiry leaves the server, never the moderator or reason.
  const suspension = await getSuspension(user.id);
  if (isSuspended(suspension, Date.now())) {
    moderationLog.info({ event: "suspended_signin_denied" }, "suspended user signin denied");
    response.status(403).json({ error: "suspended", until: suspension?.suspendedUntil });
    return;
  }
  await safelyRecordSigninOutcome(response, "success", requestLog(response, analyticsFallbackLog));
  response.json({ token: issueToken({ id: user.id, username: user.username }) });
});

api.post("/analytics/events", requireAuth, analyticsLimiter, async (request, response) => {
  const parsed = analyticsIngestRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid-event" });
    return;
  }
  const user = (request as AuthenticatedRequest).user;
  const result = await ingestAnalyticsEvent(parsed.data.eventId, user.id, parsed.data.event);
  if (result.conflict) {
    response.status(409).json({ error: "event-id-conflict" });
    return;
  }
  response.status(result.duplicate ? 200 : 202).json({
    acceptedAt: result.acceptedAt.toISOString(),
    duplicate: result.duplicate,
  });
});

api.get("/space/:id", requireAuth, async (request, response) => {
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  const space = await getSpace(id ?? "");
  if (!space) {
    response.status(404).json({ error: "space-not-found" });
    return;
  }
  response.json(space);
});

api.post("/arcade/scores", arcadeScoreLimiter, requireAuth, async (request, response) => {
  const parsed = arcadeScoreSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid-score", details: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const user = (request as AuthenticatedRequest).user;
  const best = await submitArcadeScore(user.id, parsed.data.game, parsed.data.score);
  const top = await getArcadeLeaderboard(parsed.data.game, LIMITS.arcadeLeaderboardMax);
  const payload: ArcadeLeaderboard = { game: parsed.data.game, top, best };
  response.json(payload);
});

api.get("/arcade/scores/:game", arcadeLeaderboardLimiter, requireAuth, async (request, response) => {
  const raw = Array.isArray(request.params.game) ? request.params.game[0] : request.params.game;
  const game = raw ?? "";
  if (!isArcadeGame(game)) {
    response.status(404).json({ error: "unknown-game" });
    return;
  }
  const user = (request as AuthenticatedRequest).user;
  const [top, best] = await Promise.all([
    getArcadeLeaderboard(game, LIMITS.arcadeLeaderboardMax),
    getArcadeBest(user.id, game),
  ]);
  const payload: ArcadeLeaderboard = { game, top, best };
  response.json(payload);
});

// Report ingestion (PRD 25.12): flag one broadcast chat line. The client sends
// only the server-stamped messageId + category (+ optional note); the server binds
// author/target/text from its own message snapshot and rejects forged context.
api.post("/reports", reportLimiter, requireAuth, async (request, response) => {
  const parsed = reportCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const reporter = (request as AuthenticatedRequest).user;
  const snapshot = await getReportableMessage(parsed.data.messageId);
  if (!snapshot) {
    // Unknown or expired message → the context cannot be authenticated. Refuse
    // rather than trust a client-supplied author/text (anti-forgery).
    response.status(404).json({ error: "message-not-found" });
    return;
  }
  if (snapshot.authorId === reporter.id) {
    response.status(400).json({ error: "cannot-report-self" });
    return;
  }
  const status = await insertReport({
    reporterId: reporter.id,
    targetId: snapshot.authorId,
    messageId: parsed.data.messageId,
    messageText: snapshot.text,
    scope: snapshot.scope,
    category: parsed.data.category,
    note: parsed.data.note,
  });
  moderationLog.info({ event: "report_created", status, category: parsed.data.category, scope: snapshot.scope }, "chat report ingested");
  const ack: ReportAck = { status };
  response.status(status === "created" ? 201 : 200).json(ack);
});

// Persistent block (PRD 25.13): a server-owned, symmetric-in-effect block. The
// blocker is the authenticated user; the client can only name a target id. The
// cache is updated in lock-step so live chat delivery filters immediately, in
// both directions, without a per-message DB read.
api.post("/blocks", blockLimiter, requireAuth, async (request, response) => {
  const parsed = blockCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const blocker = (request as AuthenticatedRequest).user;
  if (parsed.data.targetId === blocker.id) {
    response.status(400).json({ error: "cannot-block-self" });
    return;
  }
  const status = await insertBlock(blocker.id, parsed.data.targetId);
  blocks.addBlock(blocker.id, parsed.data.targetId);
  moderationLog.info({ event: "block_created", status }, "player block set");
  const ack: BlockAck = { status };
  response.status(status === "blocked" ? 201 : 200).json(ack);
});

// Unblock (PRD 25.13): removes only future suppression — there is no backlog to
// replay, so an unblock simply lets subsequent messages/media through again.
api.delete("/blocks", blockLimiter, requireAuth, async (request, response) => {
  const parsed = blockCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const blocker = (request as AuthenticatedRequest).user;
  const status = await removeBlock(blocker.id, parsed.data.targetId);
  blocks.removeBlock(blocker.id, parsed.data.targetId);
  moderationLog.info({ event: "block_removed", status }, "player block cleared");
  const ack: BlockAck = { status };
  response.json(ack);
});

// The requesting player's own block list (ids they blocked), loaded on connect
// so the client can mute blocked users' media/speaking locally. Authoritative
// delivery filtering is server-side regardless of what the client holds.
api.get("/blocks", blockLimiter, requireAuth, async (request, response) => {
  const user = (request as AuthenticatedRequest).user;
  await blocks.ensureLoaded(user.id);
  const payload: BlockList = { blocked: blocks.blockedBy(user.id) };
  response.json(payload);
});

api.post("/livekit/token", requireAuth, async (request, response) => {
  const parsed = liveKitSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid-room-name" });
    return;
  }
  const user = (request as AuthenticatedRequest).user;
  // Suspension gate (PRD 25.14): a suspended user cannot obtain a media token, so
  // suspension silences voice/video too (its live sockets are already dropped).
  const suspension = await getSuspension(user.id);
  if (isSuspended(suspension, Date.now())) {
    response.status(403).json({ error: "suspended", until: suspension?.suspendedUntil });
    return;
  }
  const roomName = parsed.data.roomName;
  let canPublish = true;
  let canPublishVideo = false;
  const lkRoom = roomName;  // LiveKit room name (may differ from request roomName)

  if (roomName.startsWith("world:")) {
    const spaceId = roomName.slice("world:".length);
    if (!spaceId || !(await spaceExists(spaceId))) {
      response.status(404).json({ error: "space-not-found" });
      return;
    }
  } else if (roomName.startsWith("room:")) {
    const roomId = roomName.slice("room:".length);
    const room = await getRoom(roomId);
    // A private room's media token requires BOTH the seat lock AND the same
    // room-access grant admission establishes (knock/approve or allow-all; PRD 14).
    // The seat lock
    // alone is not proof of access: the seat-claim Lua never records access, and
    // a seat lock can outlive its access grant (access is revoked on room-leave/
    // disconnect while the seat's TTL persists). Gating on access too keeps the
    // token consistent with seat-sit and room-chat — a client that never
    // presented the key can never obtain the room's audio/video.
    const occupiedSeat = await redis.get(`player-seat:${user.id}`);
    const hasAccess = await redis.exists(`room-access:${user.id}:${roomId}`);
    if (!room || !hasAccess || !occupiedSeat?.startsWith(`seat:${roomId}:`)) {
      response.status(403).json({ error: "seat-required" });
      return;
    }
    canPublishVideo = true;
  } else if (roomName.startsWith("stage:")) {
    const spaceId = roomName.slice("stage:".length);
    if (!spaceId || !(await spaceExists(spaceId))) {
      response.status(404).json({ error: "space-not-found" });
      return;
    }
    if (parsed.data.stagePublish) {
      // Server-authoritative broadcast gate (PRD 17): a publish-capable stage
      // token is issued only when the requester's server-known position is
      // inside the stage zone, so a malicious client can't hijack the stage as a
      // server-wide megaphone from anywhere on the map. Audience tokens stay open.
      const pos = await presencePosition(spaceId, user.id);
      if (!pos || !canPublishFromStage(pos.x, pos.y)) {
        response.status(403).json({ error: "not-on-stage" });
        return;
      }
      canPublishVideo = true;  // performer: mic (+ optional cam for "Go Live")
    } else {
      canPublish = false;  // audience: subscribe-only
    }
  } else {
    response.status(400).json({ error: "invalid-room-name" });
    return;
  }

  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: user.id,
    name: user.username,
    ttl: "15m"
  });
  token.addGrant({
    room: lkRoom,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: canPublish,
    ...(canPublish && !canPublishVideo ? { canPublishSources: [TrackSource.MICROPHONE] } : {})
  });
  response.json({ livekitToken: await token.toJwt(), url: config.LIVEKIT_URL });
});
