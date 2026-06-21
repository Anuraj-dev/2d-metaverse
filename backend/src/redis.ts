import { createClient } from "redis";
import { config } from "./config.js";

export const redis = createClient({ url: config.REDIS_URL });
redis.on("error", (error) => console.error("Redis error", error));

const FIXED_WINDOW_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

/**
 * Atomically consume one slot from a fixed Redis rate-limit window. Redis makes
 * this safe for future multi-process Socket.IO deployments as well.
 */
export async function isRateLimitExceeded(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const count = await redis.eval(FIXED_WINDOW_RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [String(windowSeconds)]
  });
  return Number(count) > limit;
}

export async function resetEphemeralGameState(): Promise<void> {
  // This deployment intentionally runs one Socket.IO process. If it restarts,
  // every old socket is gone, so persisted presence/seat locks are stale.
  for (const pattern of ["presence:*", "seat:*", "player-seat:*", "room-access:*"]) {
    for await (const keys of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (keys.length > 0) await redis.del(keys);
    }
  }
}
