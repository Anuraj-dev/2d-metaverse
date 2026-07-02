/**
 * Frontend error beacon: ships uncaught exceptions and unhandled promise
 * rejections to the backend's /client-errors endpoint so client-side crashes
 * become visible in the server log stream (module: "client-error").
 *
 * Telemetry must never break the game: every failure path is swallowed, and a
 * per-session cap plus a dedupe window keep a crash loop from flooding the
 * backend (which also rate limits per IP).
 */

export interface BeaconPayload {
  message: string;
  stack?: string;
  sha: string;
  url?: string;
  userAgent?: string;
  context?: string;
}

export interface BeaconOptions {
  endpoint: string;
  sha: string;
  maxPerSession?: number;
  dedupeWindowMs?: number;
  /** Optional note about the current scene/route, evaluated per report. */
  getContext?: () => string | undefined;
}

export interface BeaconState {
  sentCount: number;
  lastSentByMessage: Map<string, number>;
}

export function createBeaconState(): BeaconState {
  return { sentCount: 0, lastSentByMessage: new Map() };
}

/**
 * Pure decision: should this message be sent now? True unless the session cap
 * is exhausted or an identical message was sent within the dedupe window.
 */
export function shouldSend(
  state: BeaconState,
  message: string,
  now: number,
  { maxPerSession = 10, dedupeWindowMs = 30_000 }: { maxPerSession?: number; dedupeWindowMs?: number } = {}
): boolean {
  if (state.sentCount >= maxPerSession) return false;
  const lastSent = state.lastSentByMessage.get(message);
  if (lastSent !== undefined && now - lastSent < dedupeWindowMs) return false;
  return true;
}

/** Record that a message was sent (mutates the session state). */
export function recordSend(state: BeaconState, message: string, now: number): void {
  state.sentCount += 1;
  state.lastSentByMessage.set(message, now);
}

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** Build the POST body, truncating every field to the backend's schema caps. */
export function buildPayload(
  message: string,
  stack: string | undefined,
  options: Pick<BeaconOptions, "sha" | "getContext">,
  location: { pathname: string } = window.location,
  navigatorUserAgent: string = navigator.userAgent
): BeaconPayload {
  let context: string | undefined;
  try {
    context = options.getContext?.();
  } catch {
    context = undefined;
  }
  return {
    message: truncate(message || "unknown error", 2000),
    ...(stack ? { stack: truncate(stack, 8000) } : {}),
    sha: truncate(options.sha || "unknown", 64),
    url: truncate(location.pathname, 500),
    userAgent: truncate(navigatorUserAgent, 300),
    ...(context ? { context: truncate(context, 200) } : {})
  };
}

const UNSERIALIZABLE = "[unserializable]";

/**
 * Read a string property that may be a hostile/throwing getter (custom Error
 * subclasses can throw from `message`/`stack`). Undefined on any failure.
 */
function safeStringProp(source: unknown, key: "message" | "stack"): string | undefined {
  try {
    const value = (source as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Non-throwing `instanceof Error`. A revoked Proxy (or one with a throwing
 * `getPrototypeOf` trap) throws from the instanceof check itself.
 */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/**
 * Fully non-throwing normalization. Never blindly coerce or inspect an
 * arbitrary reason outside a fallback boundary: throwing `toJSON`/`toString`/
 * `Symbol.toPrimitive`, hostile getters, and even `instanceof` on a revoked
 * Proxy would otherwise escape the listener — and the event must still yield
 * the fallback payload rather than being dropped.
 */
function describeRejectionReason(reason: unknown): { message: string; stack?: string } {
  try {
    if (typeof reason === "string") return { message: reason || UNSERIALIZABLE };
    // Primitives coerce without invoking user code.
    if (reason === null || reason === undefined || typeof reason === "number" || typeof reason === "boolean" || typeof reason === "bigint") {
      return { message: `unhandled rejection: ${String(reason)}` };
    }
    if (isError(reason)) {
      const stack = safeStringProp(reason, "stack");
      return { message: safeStringProp(reason, "message") ?? UNSERIALIZABLE, ...(stack ? { stack } : {}) };
    }
    // May invoke a user-defined toJSON, or throw on a revoked Proxy.
    return { message: `unhandled rejection: ${JSON.stringify(reason) ?? UNSERIALIZABLE}` };
  } catch {
    return { message: `unhandled rejection: ${UNSERIALIZABLE}` };
  }
}

/**
 * Register window error handlers. Returns an uninstall function (used by tests;
 * the app installs once at boot and never uninstalls).
 */
export function installErrorBeacon(options: BeaconOptions): () => void {
  const state = createBeaconState();
  const limits = { maxPerSession: options.maxPerSession ?? 10, dedupeWindowMs: options.dedupeWindowMs ?? 30_000 };

  const report = (message: string, stack: string | undefined) => {
    try {
      const now = Date.now();
      if (!shouldSend(state, message, now, limits)) return;
      recordSend(state, message, now);
      const payload = buildPayload(message, stack, options);
      void fetch(options.endpoint, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {
        /* telemetry failures are silent by design */
      });
    } catch {
      /* never let the beacon itself throw */
    }
  };

  // The ENTIRE listener body is wrapped: normalizing hostile values (throwing
  // getters/coercions) must never escape a global error handler, or the beacon
  // would generate the next error event itself.
  const onError = (event: ErrorEvent) => {
    try {
      // Same fallback boundary as rejections: even if inspecting event.error
      // fails at any step (revoked Proxy, hostile getters), the event must
      // still be reported with the fallback text, never dropped.
      let stack: string | undefined;
      let errorMessage: string | undefined;
      try {
        const error = event.error as unknown;
        if (isError(error)) {
          stack = safeStringProp(error, "stack");
          errorMessage = safeStringProp(error, "message");
        }
      } catch {
        /* fall through to the fallback message */
      }
      const message = (typeof event.message === "string" && event.message) || errorMessage || UNSERIALIZABLE;
      report(message, stack);
    } catch {
      /* never let the beacon itself throw */
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    try {
      const { message, stack } = describeRejectionReason(event.reason);
      report(message, stack);
    } catch {
      /* never let the beacon itself throw */
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
