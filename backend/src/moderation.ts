/**
 * Moderator surface (PRD 25.14), mounted at `/api/v1/mod`. Every route is gated
 * by `requireModerator` (validated operator allowlist — room admins get nothing).
 * Moderators can review/dismiss reports, warn a user, suspend-until a timestamp,
 * and reverse a suspension. Suspension enforcement lives at the auth boundaries
 * (signin / socket handshake / media-token in api.ts + socket.ts); this module
 * writes the suspension record, drops live sessions, and audit-logs every action.
 *
 * Audit discipline: pino lines carry ids + action + timestamps only — never chat
 * text or the reason free-text (the smallest justified snapshot already lives on
 * the report row; the durable trail is the moderation_actions table).
 */
import { Router } from "express";
import rateLimit, { type RateLimitInfo } from "express-rate-limit";
import {
  LIMITS,
  RATE_LIMITS,
  moderationSuspendSchema,
  moderationUnsuspendSchema,
  moderationWarnSchema,
  type ModerationActionAck,
  type ModerationReport,
  type ModerationReportList,
} from "@metaverse/shared";
import { type AuthenticatedRequest } from "./auth.js";
import { childLogger } from "./logger.js";
import { requireModerator } from "./moderator.js";
import {
  deleteSuspension,
  listOpenReports,
  recordModerationAction,
  setReportStatus,
  upsertSuspension,
  userExists,
} from "./repository.js";
import { disconnectUser } from "./socket.js";

const auditLog = childLogger({ module: "moderation" });

export const moderation = Router();

const moderationLimiter = rateLimit({
  windowMs: RATE_LIMITS.moderationWindowMs,
  limit: RATE_LIMITS.moderationLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (request, response) => {
    const resetTime = (request as typeof request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
    const remainingMs = resetTime ? resetTime.getTime() - Date.now() : RATE_LIMITS.moderationWindowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.min(Math.ceil(remainingMs / 1000), Math.ceil(RATE_LIMITS.moderationWindowMs / 1000)),
    );
    response.status(429).json({ error: "rate-limited", retryAfterSeconds });
  },
});

// Guard THEN limit: a non-moderator gets a uniform 404 from requireModerator and
// never even reaches (or can probe the timing of) the shared moderator limiter.
moderation.use(requireModerator, moderationLimiter);

const ack: ModerationActionAck = { ok: true };

/** GET /mod/reports — the open review queue, newest first. */
moderation.get("/reports", async (_request, response) => {
  const rows = await listOpenReports(LIMITS.moderationReportsMax);
  const reports: ModerationReport[] = rows.map((row) => ({
    id: row.id,
    reporterId: row.reporterId,
    targetId: row.targetId,
    messageId: row.messageId,
    messageText: row.messageText,
    scope: row.scope,
    category: row.category as ModerationReport["category"],
    note: row.note,
    status: row.status as ModerationReport["status"],
    createdAt: row.createdAt,
  }));
  const payload: ModerationReportList = { reports };
  response.json(payload);
});

/** POST /mod/reports/:id/dismiss — review with no action. */
moderation.post("/reports/:id/dismiss", async (request, response) => {
  // Via `unknown`: express narrows params to `{ id: string }` on this route, which
  // no longer overlaps AuthenticatedRequest for a direct assertion. requireModerator
  // guarantees `.user` is present.
  const moderator = (request as unknown as AuthenticatedRequest).user;
  const raw = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  const reportId = raw ?? "";
  const result = await setReportStatus(reportId, "dismissed", moderator.id);
  if (!result) {
    response.status(404).json({ error: "not-found" });
    return;
  }
  await recordModerationAction({
    actorId: moderator.id,
    targetId: result.targetId,
    action: "dismiss",
    reportId,
  });
  auditLog.info(
    { event: "report_dismissed", actorId: moderator.id, reportId, targetId: result.targetId },
    "report dismissed",
  );
  response.json(ack);
});

/** POST /mod/warn — record a warning against a user. */
moderation.post("/warn", async (request, response) => {
  const parsed = moderationWarnSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const moderator = (request as AuthenticatedRequest).user;
  if (!(await userExists(parsed.data.targetId))) {
    response.status(404).json({ error: "target-not-found" });
    return;
  }
  await recordModerationAction({
    actorId: moderator.id,
    targetId: parsed.data.targetId,
    action: "warn",
    reason: parsed.data.reason ?? null,
  });
  auditLog.info(
    { event: "user_warned", actorId: moderator.id, targetId: parsed.data.targetId },
    "user warned",
  );
  response.json(ack);
});

/** POST /mod/suspend — suspend a user until a server timestamp and drop live sessions. */
moderation.post("/suspend", async (request, response) => {
  const parsed = moderationSuspendSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const moderator = (request as AuthenticatedRequest).user;
  if (parsed.data.until <= Date.now()) {
    response.status(400).json({ error: "invalid-until" });
    return;
  }
  if (!(await userExists(parsed.data.targetId))) {
    response.status(404).json({ error: "target-not-found" });
    return;
  }
  await upsertSuspension(parsed.data.targetId, parsed.data.until, moderator.id, parsed.data.reason);
  await recordModerationAction({
    actorId: moderator.id,
    targetId: parsed.data.targetId,
    action: "suspend",
    suspendUntil: parsed.data.until,
    reason: parsed.data.reason ?? null,
  });
  // Enforce immediately: drop any live session so the suspension does not wait for
  // the next reconnect (new auth/socket/media-token are already gated).
  const disconnected = disconnectUser(parsed.data.targetId);
  auditLog.info(
    {
      event: "user_suspended",
      actorId: moderator.id,
      targetId: parsed.data.targetId,
      suspendUntil: parsed.data.until,
      disconnected,
    },
    "user suspended",
  );
  response.json(ack);
});

/** POST /mod/unsuspend — reverse a suspension, restoring access. */
moderation.post("/unsuspend", async (request, response) => {
  const parsed = moderationUnsuspendSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation" });
    return;
  }
  const moderator = (request as AuthenticatedRequest).user;
  // Reversal is idempotent: nothing on record is still a success (access already
  // open). We only need the target to exist to keep the audit trail honest.
  if (!(await userExists(parsed.data.targetId))) {
    response.status(404).json({ error: "target-not-found" });
    return;
  }
  const removed = await deleteSuspension(parsed.data.targetId);
  await recordModerationAction({
    actorId: moderator.id,
    targetId: parsed.data.targetId,
    action: "unsuspend",
  });
  auditLog.info(
    { event: "user_unsuspended", actorId: moderator.id, targetId: parsed.data.targetId, removed },
    "user unsuspended",
  );
  response.json(ack);
});
