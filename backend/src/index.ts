import { createServer } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { geometryManifestPath, getGeometryManifest, GeometryManifestError } from "./geometry.js";
import { childLogger } from "./logger.js";
import { redis, resetEphemeralGameState } from "./redis.js";

const log = childLogger({ module: "http" });

// Fail fast on a missing/invalid/stale geometry manifest — the server must never
// boot without the authoritative campus geometry it validates positions against.
try {
  const manifest = getGeometryManifest();
  log.info(
    {
      version: manifest.version,
      rooms: manifest.rooms.length,
      doors: manifest.doors.length,
      seats: manifest.seats.length,
      boardSeats: manifest.boardSeats.length,
      stageZones: manifest.stageZones.length,
      portals: manifest.portals.length,
    },
    "loaded geometry manifest",
  );
} catch (error) {
  const detail = error instanceof GeometryManifestError ? error.detail : undefined;
  log.fatal({ err: error, detail, path: geometryManifestPath() }, "geometry manifest load failed");
  process.exit(1);
}

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
