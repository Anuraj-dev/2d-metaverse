import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { childLogger } from "./logger.js";

const log = childLogger({ module: "migrate" });

/**
 * Apply pending .sql migrations in name order. `migrationsDir` is overridable
 * so tests can point the runner at a fixture directory; production callers use
 * the default (the repo's migrations/ directory).
 */
export async function migrate(
  migrationsDir: string = fileURLToPath(new URL("../migrations/", import.meta.url))
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (exists.rowCount) continue;
      const sql = await readFile(path.join(migrationsDir, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        log.info({ migration: name }, "applied migration");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((error) => { log.fatal({ err: error }, "migration failed"); process.exit(1); });
}
