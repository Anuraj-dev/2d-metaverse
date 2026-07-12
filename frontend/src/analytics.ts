/**
 * Product-analytics emitter (PRD 25.9 contract, 25.10 first events).
 *
 * The authenticated sibling of the operational reporter: where
 * `operationalReport.ts` ships CAUGHT crashes to a log-only sink, this ships
 * bounded, allowlisted PRODUCT events to the durable analytics store
 * (`POST /api/v1/analytics/events`, `requireAuth`). Every payload shape is a
 * variant of the shared `AnalyticsClientEvent` union — the client can never
 * supply identity or timestamps, which the server owns.
 *
 * Discipline (identical to the beacon): fire-and-forget, every failure path
 * swallowed — telemetry must never break the game. Each send carries a
 * client-generated `eventId` (UUID); a transient failure (network / 5xx / 429)
 * is retried with the SAME id so the server's idempotency suppresses the
 * duplicate. `emitOnce` additionally guarantees a logical event is enqueued at
 * most once per key, so a repeated trigger cannot double-count.
 */
import type { AnalyticsClientEvent } from "@metaverse/shared";
import {
  createOnceGuard,
  isRetryable,
  retryDelayMs,
  type DeliveryResult,
  type OnceGuard,
} from "./game/reliability";

export interface AnalyticsEmitterOptions {
  /** Full ingestion URL, e.g. `${SERVER_URL}/api/v1/analytics/events`. */
  endpoint: string;
  /** Session JWT provider (the same token the socket handshake uses). */
  getToken: () => string;
  /** Total delivery attempts including the first (default 4). */
  maxAttempts?: number;
  /** Base backoff, doubled per attempt (default 500ms). */
  baseDelayMs?: number;
  /** Backoff ceiling (default 5000ms). */
  maxDelayMs?: number;
  /** Injectable seams for tests. */
  fetchImpl?: typeof fetch;
  generateId?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface AnalyticsEmitter {
  /** Emit an event now (fire-and-forget). */
  emit(event: AnalyticsClientEvent): void;
  /** Emit at most once per `key` for this emitter's lifetime. */
  emitOnce(key: string, event: AnalyticsClientEvent): void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function randomId(): string {
  // crypto.randomUUID is available in every supported browser + jsdom/node.
  return crypto.randomUUID();
}

export function createAnalyticsEmitter(options: AnalyticsEmitterOptions): AnalyticsEmitter {
  const guard: OnceGuard = createOnceGuard();
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const nextId = options.generateId ?? randomId;
  const sleep = options.sleep ?? defaultSleep;

  async function attempt(eventId: string, event: AnalyticsClientEvent): Promise<DeliveryResult> {
    const res = await doFetch(options.endpoint, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.getToken()}`,
      },
      body: JSON.stringify({ eventId, event }),
    });
    return { kind: "http", status: res.status };
  }

  async function deliver(event: AnalyticsClientEvent): Promise<void> {
    // One id for the whole retry chain: replays are duplicates the server drops.
    const eventId = nextId();
    for (let n = 1; n <= maxAttempts; n++) {
      let result: DeliveryResult;
      try {
        result = await attempt(eventId, event);
      } catch {
        result = { kind: "network" };
      }
      if (!isRetryable(result)) return;
      if (n < maxAttempts) await sleep(retryDelayMs(n, baseDelayMs, maxDelayMs));
    }
  }

  const send = (event: AnalyticsClientEvent): void => {
    try {
      void deliver(event).catch(() => {
        /* telemetry failures are silent by design */
      });
    } catch {
      /* never let the emitter itself throw */
    }
  };

  return {
    emit(event) {
      send(event);
    },
    emitOnce(key, event) {
      try {
        if (!guard.fire(key)) return;
        send(event);
      } catch {
        /* never let the emitter itself throw */
      }
    },
  };
}

/**
 * A drop-everything emitter — the default so call sites can always call
 * `getAnalyticsEmitter()` without a null check (mock mode, tests, pre-boot).
 */
const noopEmitter: AnalyticsEmitter = {
  emit() {},
  emitOnce() {},
};

let active: AnalyticsEmitter = noopEmitter;

/** Install the process-wide emitter at boot (real-backend mode only). */
export function installAnalyticsEmitter(options: AnalyticsEmitterOptions): AnalyticsEmitter {
  active = createAnalyticsEmitter(options);
  return active;
}

/** The process-wide emitter; a no-op until `installAnalyticsEmitter` runs. */
export function getAnalyticsEmitter(): AnalyticsEmitter {
  return active;
}

/** Compatibility facade for existing bounded product-event call sites. */
export function emitAnalytics(event: AnalyticsClientEvent): void {
  active.emit(event);
}
