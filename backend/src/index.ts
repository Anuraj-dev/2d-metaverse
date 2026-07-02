import { createServer } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { childLogger } from "./logger.js";
import { redis, resetEphemeralGameState } from "./redis.js";

const log = childLogger({ module: "http" });

await redis.connect();
await resetEphemeralGameState();
const { server, io } = createServer();
server.listen(config.PORT, "0.0.0.0", () => log.info({ port: config.PORT }, "backend listening"));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "shutting down");
  void io.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([redis.quit(), pool.end()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
