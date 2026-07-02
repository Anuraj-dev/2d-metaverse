import pg from "pg";
import { config } from "./config.js";
import { childLogger } from "./logger.js";

const log = childLogger({ module: "db" });

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => log.error({ err: error }, "unexpected PostgreSQL pool error"));
