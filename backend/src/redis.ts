import { createClient } from "redis";
import { config } from "./config.js";

export const redis = createClient({ url: config.REDIS_URL });
redis.on("error", (error) => console.error("Redis error", error));

export async function resetEphemeralGameState(): Promise<void> {
  // This deployment intentionally runs one Socket.IO process. If it restarts,
  // every old socket is gone, so persisted presence/seat locks are stale.
  for (const pattern of ["presence:*", "seat:*", "player-seat:*", "room-access:*"]) {
    for await (const keys of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (keys.length > 0) await redis.del(keys);
    }
  }
}
