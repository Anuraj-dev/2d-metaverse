import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AnalyticsClientEvent } from "@metaverse/shared";
import { pool } from "./db.js";
import type { Logger } from "pino";

export const ANALYTICS_RETENTION_DAYS = 90;
export const SIGNIN_ANALYTICS_RETENTION_DAYS = 7;

export const SIGNIN_OUTCOMES = [
  "success",
  "validation",
  "invalid-credentials",
  "rate-limited",
  "server-error",
] as const;
export type SigninOutcome = (typeof SIGNIN_OUTCOMES)[number];

interface StoredEvent {
  actor_user_id: string | null;
  event_name: string;
  occurred_at: Date;
}

export interface AnalyticsIngestResult {
  acceptedAt: Date;
  duplicate: boolean;
  conflict: boolean;
}

export function beginSigninAttempt(_request: Request, response: Response, next: NextFunction): void {
  response.locals.analyticsSigninAttemptId = randomUUID();
  next();
}

function signinAttemptId(response: Response): string {
  const value: unknown = response.locals.analyticsSigninAttemptId;
  return typeof value === "string" ? value : randomUUID();
}

export async function pruneExpiredAnalyticsEvents(now: Date = new Date()): Promise<number> {
  const deleted = await pool.query("DELETE FROM analytics_events WHERE expires_at <= $1", [now]);
  return deleted.rowCount ?? 0;
}

export async function recordSigninOutcome(response: Response, result: SigninOutcome): Promise<void> {
  await pruneExpiredAnalyticsEvents();
  await pool.query(
    `INSERT INTO analytics_events
       (event_id, event_name, actor_user_id, properties, expires_at)
     VALUES ($1, 'signin-outcome', NULL, $2::jsonb, now() + ($3 * interval '1 day'))`,
    [signinAttemptId(response), JSON.stringify({ result }), SIGNIN_ANALYTICS_RETENTION_DAYS],
  );
}

export async function safelyRecordSigninOutcome(
  response: Response,
  result: SigninOutcome,
  log: Logger,
): Promise<void> {
  try {
    await recordSigninOutcome(response, result);
  } catch (error) {
    log.warn({ err: error, analyticsEvent: "signin-outcome" }, "analytics emission failed");
  }
}

export async function ingestAnalyticsEvent(
  eventId: string,
  actorUserId: string,
  event: AnalyticsClientEvent,
): Promise<AnalyticsIngestResult> {
  await pruneExpiredAnalyticsEvents();
  const inserted = await pool.query<{ occurred_at: Date }>(
    `INSERT INTO analytics_events
       (event_id, event_name, actor_user_id, properties, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, now() + ($5 * interval '1 day'))
     ON CONFLICT (event_id) DO NOTHING
     RETURNING occurred_at`,
    [eventId, event.name, actorUserId, JSON.stringify({}), ANALYTICS_RETENTION_DAYS],
  );
  const accepted = inserted.rows[0];
  if (accepted) return { acceptedAt: accepted.occurred_at, duplicate: false, conflict: false };

  const existing = await pool.query<StoredEvent>(
    `SELECT actor_user_id, event_name, occurred_at
       FROM analytics_events WHERE event_id = $1`,
    [eventId],
  );
  const row = existing.rows[0];
  if (!row || row.actor_user_id !== actorUserId || row.event_name !== event.name) {
    return { acceptedAt: row?.occurred_at ?? new Date(0), duplicate: false, conflict: true };
  }
  return { acceptedAt: row.occurred_at, duplicate: true, conflict: false };
}
