import { createClient } from "redis";
import { config } from "./config.js";
import { childLogger } from "./logger.js";

const log = childLogger({ module: "redis" });

export const redis = createClient({ url: config.REDIS_URL });
redis.on("error", (error) => log.error({ err: error }, "redis error"));

const FIXED_WINDOW_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

/** Outcome of consuming one slot from a rate-limit window. */
export interface RateLimitResult {
  /** True when this attempt pushed the player past the limit (should be refused). */
  exceeded: boolean;
  /**
   * Milliseconds until the window resets and the next send is accepted. Derived
   * from the key's live TTL, so it shrinks as the window drains; falls back to the
   * full window if Redis reports no expiry yet (`-1`/`-2`).
   */
  retryAfterMs: number;
}

/**
 * Atomically consume one slot from a fixed Redis rate-limit window, returning both
 * whether the caller is over the limit and how long until the window resets. Redis
 * makes this safe for future multi-process Socket.IO deployments as well.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = (await redis.eval(FIXED_WINDOW_RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [String(windowSeconds)]
  })) as [number, number];
  const count = Number(result[0]);
  const ttl = Number(result[1]);
  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
  return { exceeded: count > limit, retryAfterMs: retryAfterSeconds * 1000 };
}

/**
 * Boolean-only convenience wrapper around {@link checkRateLimit} for call sites
 * that silently discard the excess (e.g. knock attempts) and need no retry timing.
 */
export async function isRateLimitExceeded(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { exceeded } = await checkRateLimit(key, limit, windowSeconds);
  return exceeded;
}

/**
 * The authoritative snapshot of a broadcast chat line, kept briefly so a later
 * report can bind who actually said what without trusting the client or
 * retaining a transcript (PRD 25.12). Written at broadcast, read at report time.
 */
export interface ReportableMessage {
  authorId: string;
  authorName: string;
  text: string;
  scope: string;
  spaceId: string;
  ts: number;
}

function chatMessageKey(messageId: string): string {
  return `chatmsg:${messageId}`;
}

/** Store a chat line's authoritative snapshot under a bounded TTL (PRD 25.12). */
export async function storeReportableMessage(
  messageId: string,
  snapshot: ReportableMessage,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(chatMessageKey(messageId), JSON.stringify(snapshot), { EX: ttlSeconds });
}

/**
 * Read a chat line's snapshot for report binding, or null if it is unknown or
 * expired. A null result means the reported context cannot be authenticated —
 * the report is refused rather than trusting client-supplied author/text.
 */
export async function getReportableMessage(messageId: string): Promise<ReportableMessage | null> {
  const raw = await redis.get(chatMessageKey(messageId));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" && value !== null &&
      "authorId" in value && typeof value.authorId === "string" &&
      "authorName" in value && typeof value.authorName === "string" &&
      "text" in value && typeof value.text === "string" &&
      "scope" in value && typeof value.scope === "string" &&
      "spaceId" in value && typeof value.spaceId === "string" &&
      "ts" in value && typeof value.ts === "number"
    ) {
      return { authorId: value.authorId, authorName: value.authorName, text: value.text, scope: value.scope, spaceId: value.spaceId, ts: value.ts };
    }
  } catch {
    // Malformed snapshot → treat as unknown (report refused).
  }
  return null;
}

export async function resetEphemeralGameState(): Promise<void> {
  // This deployment intentionally runs one Socket.IO process. If it restarts,
  // every old socket is gone, so persisted presence/seat locks are stale.
  for (const pattern of ["presence:*", "seat:*", "player-seat:*", "room-access:*", "board:*", "room-admin:*", "chatmsg:*"]) {
    for await (const keys of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (keys.length > 0) await redis.del(keys);
    }
  }
}
