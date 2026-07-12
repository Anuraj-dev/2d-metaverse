/**
 * Pure pilot-reliability analytics logic (PRD 25.10).
 *
 * Plain values in / plain values out — no Phaser, net, or DOM. The glue
 * (`App.tsx`, `ControlBar.tsx`, `analytics.ts`) feeds it raw transitions and
 * timestamps and ships whatever bounded `AnalyticsClientEvent` it returns; the
 * decision of *whether* and *what* to emit lives only here.
 *
 * Every event this builds is drawn from the shared allowlist and carries only
 * coarse, closed-enum outcomes plus a capped duration — never credentials,
 * chat, coordinates, SDP, or device identifiers. Identity and timestamps are
 * deliberately absent: the server owns both.
 */
import type { AnalyticsClientEvent } from "@metaverse/shared";
import { RELIABILITY_MAX_DURATION_MS } from "@metaverse/shared";
import type { ConnectionStatus } from "./connectionState";
import type { MediaOutcomeStatus } from "../media/publicationState";

type ReconnectOutcome = Extract<AnalyticsClientEvent, { name: "reconnect" }>["properties"]["outcome"];
type MediaOutcome = Extract<AnalyticsClientEvent, { name: "media-enable" }>["properties"]["outcome"];
type MediaKind = Extract<AnalyticsClientEvent, { name: "media-enable" }>["properties"]["kind"];
type WorldLoadOutcome = Extract<AnalyticsClientEvent, { name: "world-load" }>["properties"]["outcome"];

/* ------------------------------ event builders ---------------------------- */

/** World-load outcome + duration, one per world-entry attempt. */
export function worldLoadEvent(outcome: WorldLoadOutcome, durationMs: number): AnalyticsClientEvent {
  return { name: "world-load", properties: { outcome, durationMs: clampDuration(durationMs) } };
}

/** A single reconnect start/outcome record. */
export function reconnectEvent(outcome: ReconnectOutcome): AnalyticsClientEvent {
  return { name: "reconnect", properties: { outcome } };
}

/** A media enable outcome (success or a bounded failure class). */
export function mediaEnableEvent(kind: MediaKind, outcome: MediaOutcome): AnalyticsClientEvent {
  return { name: "media-enable", properties: { kind, outcome } };
}

/** The crash-free-session denominator, one per world session. */
export function sessionStartEvent(): AnalyticsClientEvent {
  return { name: "session-start", properties: {} };
}

/* ----------------------------- pure decisions ----------------------------- */

/**
 * Clamp a raw elapsed-ms measure to a bounded non-negative integer. A stuck or
 * backgrounded tab can produce a huge (or, across a clock adjustment, negative)
 * delta; the wire only ever carries `0..RELIABILITY_MAX_DURATION_MS`.
 */
export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(Math.round(ms), RELIABILITY_MAX_DURATION_MS);
}

/**
 * Map a connection-state transition onto a reliability reconnect outcome, or
 * `null` when the transition is not a reportable reconnect moment.
 *
 *  - entering `reconnecting` (from a healthy state) is the `started` moment;
 *  - `recovered` = the session was restored;
 *  - `connected` *after* a `reconnecting` episode = `resumed` (reconnected
 *    without server recovery);
 *  - `gone` = the link failed terminally.
 *
 * A plain first `connected`/`connecting`, or staying in `reconnecting`, is not
 * reported.
 */
export function reconnectOutcome(
  prev: ConnectionStatus,
  next: ConnectionStatus,
): ReconnectOutcome | null {
  if (next === prev) return null;
  switch (next) {
    case "reconnecting":
      return "started";
    case "recovered":
      return "recovered";
    case "connected":
      return prev === "reconnecting" ? "resumed" : null;
    case "gone":
      return "failed";
    default:
      return null;
  }
}

/**
 * Map a confirmed media publication status onto a bounded enable outcome. A
 * live publication is `success`; the three failure classes pass through; the
 * benign non-publishing states (`off`/`inactive`, e.g. mock mode or a no-op
 * publisher) are treated as `success` since the enable did not fail.
 */
export function mediaEnableOutcome(status: MediaOutcomeStatus): MediaOutcome {
  switch (status) {
    case "denied":
    case "unavailable":
    case "failed":
      return status;
    default:
      return "success";
  }
}

/* ------------------------------- once-guard ------------------------------- */

/**
 * A tiny idempotency guard: `fire(key)` returns true exactly once per key, so a
 * logical event (e.g. this session's `world-load`) is emitted at most once even
 * if its trigger fires repeatedly (a late second `init`, a re-render).
 */
export interface OnceGuard {
  fire(key: string): boolean;
  reset(): void;
}

export function createOnceGuard(): OnceGuard {
  const fired = new Set<string>();
  return {
    fire(key) {
      if (fired.has(key)) return false;
      fired.add(key);
      return true;
    },
    reset() {
      fired.clear();
    },
  };
}

/* ------------------------------ retry policy ------------------------------ */

export type DeliveryResult = { kind: "network" } | { kind: "http"; status: number };

/**
 * Whether a delivery result warrants a retry (with the SAME event id, so the
 * server's idempotency suppresses the duplicate). Transient failures — a
 * network throw, a 5xx, or a 429 — are retryable; a 2xx is done and any other
 * 4xx (invalid event, id conflict) is a permanent outcome we never retry.
 */
export function isRetryable(result: DeliveryResult): boolean {
  if (result.kind === "network") return true;
  return result.status >= 500 || result.status === 429;
}

/** Exponential backoff with a ceiling: base, 2·base, 4·base … capped at max. */
export function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const delay = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, maxMs);
}
