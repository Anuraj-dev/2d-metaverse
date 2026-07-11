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

export async function resetEphemeralGameState(): Promise<void> {
  // This deployment intentionally runs one Socket.IO process. If it restarts,
  // every old socket is gone, so persisted presence/seat locks are stale.
  for (const pattern of ["presence:*", "seat:*", "player-seat:*", "room-access:*", "board:*", "room-admin:*"]) {
    for await (const keys of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (keys.length > 0) await redis.del(keys);
    }
  }
}
