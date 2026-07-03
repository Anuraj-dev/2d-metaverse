/**
 * Runs before each integration test file, ahead of any src import, so the
 * env is final before src/config.ts snapshots it.
 *
 * Defaults target the dev compose stack from the repo root
 * (`docker compose up -d postgres redis`), with Redis pointed at logical DB 1
 * so game state never collides with a dev server on DB 0. Override
 * DATABASE_URL / REDIS_URL to point elsewhere.
 *
 * Fails fast with a clear message when either service is unreachable.
 */
import pg from "pg";
import { createClient } from "redis";

process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "fatal";
process.env.DATABASE_URL ??= "postgres://metaverse:metaverse@localhost:5432/metaverse";
process.env.REDIS_URL ??= "redis://localhost:6379/1";
process.env.JWT_SECRET ??= "integration-test-jwt-secret-0123456789abcdef";
process.env.LIVEKIT_URL ??= "ws://localhost:7880";
process.env.LIVEKIT_API_KEY ??= "devkey";
process.env.LIVEKIT_API_SECRET ??= "local-development-livekit-secret-change-me";
process.env.ROOM_1_KEY ??= "1234";
process.env.ROOM_2_KEY ??= "4321";
process.env.ROOM_3_KEY ??= "3333";
process.env.ROOM_4_KEY ??= "4444";
process.env.ROOM_5_KEY ??= "5555";
process.env.ROOM_6_KEY ??= "6666";
process.env.STAGE_KEY ??= "stage-presenter-123";
// Shrink socket timings so timeout/grace paths are testable in milliseconds.
process.env.JOIN_TIMEOUT_MS ??= "500";
process.env.LEAVE_GRACE_MS ??= "400";
process.env.MEETING_COUNTDOWN_MS ??= "300";

const failure = (service: string, url: string, hint: string) =>
  `Integration tests require ${service} at ${url} but it is unreachable. ` +
  `Start the dev services with \`docker compose up -d postgres redis\` from the repo root ` +
  `(then \`npm run db:migrate && npm run db:seed\` once), or point ${hint} at a running instance.`;

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

const pgClient = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 });
try {
  await pgClient.connect();
  await pgClient.query("SELECT 1");
} catch (error) {
  throw new Error(`${failure("PostgreSQL", databaseUrl, "DATABASE_URL")} (${String(error)})`, {
    cause: error,
  });
} finally {
  await pgClient.end().catch(() => undefined);
}

const redisProbe = createClient({ url: redisUrl, socket: { connectTimeout: 3_000, reconnectStrategy: false } });
redisProbe.on("error", () => undefined);
try {
  await redisProbe.connect();
  await redisProbe.ping();
} catch (error) {
  throw new Error(`${failure("Redis", redisUrl, "REDIS_URL")} (${String(error)})`, {
    cause: error,
  });
} finally {
  if (redisProbe.isOpen) await redisProbe.quit().catch(() => undefined);
}
