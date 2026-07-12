/**
 * Handled-operational-error reporting (PRD 25.8). A sibling of the crash beacon
 * (`errorBeacon.ts`): where the beacon ships UNCAUGHT exceptions/rejections,
 * this ships CAUGHT operational failures — auth-transport, reconnect, and media
 * publish failures — to the same backend sink, as a bounded `{ category, reason }`
 * pair drawn only from the shared allowlists.
 *
 * Privacy: there is no free-text message/stack here. Reports carry only a stable
 * category + closed-enum reason plus the same coarse, capped fields as the crash
 * beacon (build sha, pathname, user-agent, a short scene note) — never chat,
 * credentials, precise coordinates, SDP, or raw device identifiers.
 *
 * Telemetry must never break the game: every send is fire-and-forget and every
 * failure path is swallowed, and it reuses the beacon's per-session cap + dedupe
 * window (keyed by `category:reason`) so a reconnect storm can't flood the sink.
 */
import type { OperationalReport } from "@metaverse/shared";
import { LIMITS } from "@metaverse/shared";
import { createBeaconState, recordSend, shouldSend, type BeaconState } from "./errorBeacon";
import type { ConnectionStatus } from "./game/connectionState";
import type { MediaFailure } from "./media/publicationState";

type AuthTransportReason = Extract<OperationalReport, { category: "auth-transport" }>["reason"];
type ReconnectReason = Extract<OperationalReport, { category: "reconnect" }>["reason"];

export interface OperationalReporterOptions {
  endpoint: string;
  sha: string;
  maxPerSession?: number;
  dedupeWindowMs?: number;
  /** Optional short note about the current scene/route, evaluated per report. */
  getContext?: () => string | undefined;
}

export interface OperationalReporter {
  /** Report a reconnect outcome; a no-op for non-reportable (healthy) statuses. */
  reportReconnect(status: ConnectionStatus): void;
  /** Report a media publish failure (bounded reason from `classifyMediaError`). */
  reportMediaPublishFailure(failure: MediaFailure): void;
  /** Report an auth-transport failure (token fetch / socket auth). */
  reportAuthTransport(reason: AuthTransportReason): void;
}

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/**
 * Pure decision: which connection statuses are worth reporting, and under what
 * bounded reason. Healthy/transient-normal states (`connecting`, `connected`)
 * are not reported (return null); the notable outcomes map 1:1 to a reason.
 */
export function reconnectReason(status: ConnectionStatus): ReconnectReason | null {
  switch (status) {
    case "reconnecting":
      return "reconnecting";
    case "recovered":
      return "recovered";
    case "gone":
      return "gone";
    default:
      return null;
  }
}

/**
 * Pure decision: which auth-transport outcomes are worth reporting, and under
 * what bounded reason. A network/fetch throw is `network`; an HTTP 401 is
 * `unauthorized`; a 5xx is `server-error`. Expected app-level outcomes
 * (validation 400, username-taken 409, rate-limited 429) are NOT transport
 * failures — they return null and are never reported.
 */
export function authTransportReason(
  outcome: { kind: "network" } | { kind: "http"; status: number }
): AuthTransportReason | null {
  if (outcome.kind === "network") return "network";
  if (outcome.status === 401) return "unauthorized";
  if (outcome.status >= 500) return "server-error";
  return null;
}

/**
 * Build the POST body for one operational report, truncating the coarse fields
 * to the shared beacon caps. `url` is a pathname only (no query/hash) so it
 * cannot carry tokens or coordinates.
 */
export function buildOperationalReport(
  category: OperationalReport["category"],
  reason: string,
  options: Pick<OperationalReporterOptions, "sha" | "getContext">,
  location: { pathname: string } = window.location,
  navigatorUserAgent: string = navigator.userAgent
): OperationalReport {
  let context: string | undefined;
  try {
    context = options.getContext?.();
  } catch {
    context = undefined;
  }
  const base = {
    sha: truncate(options.sha || "unknown", LIMITS.clientErrorShaMax),
    url: truncate(location.pathname, LIMITS.clientErrorUrlMax),
    userAgent: truncate(navigatorUserAgent, LIMITS.clientErrorUserAgentMax),
    ...(context ? { context: truncate(context, LIMITS.clientErrorContextMax) } : {}),
  };
  switch (category) {
    case "auth-transport":
      return { category, reason: reason as AuthTransportReason, ...base };
    case "reconnect":
      return { category, reason: reason as ReconnectReason, ...base };
    case "media-publish":
      return { category, reason: reason as MediaFailure, ...base };
  }
}

/**
 * Create a reporter bound to an endpoint + build sha. Each report is deduped by
 * `category:reason` and capped per session (shared with the beacon's discipline).
 */
export function createOperationalReporter(options: OperationalReporterOptions): OperationalReporter {
  const state: BeaconState = createBeaconState();
  const limits = {
    maxPerSession: options.maxPerSession ?? 20,
    dedupeWindowMs: options.dedupeWindowMs ?? 30_000,
  };

  const send = (category: OperationalReport["category"], reason: string) => {
    try {
      const key = `${category}:${reason}`;
      const now = Date.now();
      if (!shouldSend(state, key, now, limits)) return;
      recordSend(state, key, now);
      const payload = buildOperationalReport(category, reason, options);
      void fetch(options.endpoint, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        /* telemetry failures are silent by design */
      });
    } catch {
      /* never let the reporter itself throw */
    }
  };

  return {
    reportReconnect(status) {
      try {
        const reason = reconnectReason(status);
        if (reason === null) return;
        send("reconnect", reason);
      } catch {
        /* never let the reporter itself throw */
      }
    },
    reportMediaPublishFailure(failure) {
      send("media-publish", failure);
    },
    reportAuthTransport(reason) {
      send("auth-transport", reason);
    },
  };
}

/**
 * A reporter that drops everything — the default so call sites can always call
 * `getOperationalReporter()` without a null check (mock mode, tests, pre-boot).
 */
const noopReporter: OperationalReporter = {
  reportReconnect() {},
  reportMediaPublishFailure() {},
  reportAuthTransport() {},
};

let active: OperationalReporter = noopReporter;

/** Install the process-wide reporter at boot (real-backend mode only). */
export function installOperationalReporter(options: OperationalReporterOptions): OperationalReporter {
  active = createOperationalReporter(options);
  return active;
}

/** The process-wide reporter; a no-op until `installOperationalReporter` runs. */
export function getOperationalReporter(): OperationalReporter {
  return active;
}
