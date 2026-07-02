/**
 * Migration-runner tests against a throwaway fixture directory and a dedicated
 * Postgres schema. The schema is selected by appending a search_path option to
 * DATABASE_URL BEFORE src/db.js is imported (hence the dynamic imports), so
 * nothing here can touch the real public schema. Dropped afterwards.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const schemaName = `migtest_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
const adminUrl = process.env.DATABASE_URL!;
{
  const url = new URL(adminUrl);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  process.env.DATABASE_URL = url.toString();
}

// Imported only now, so src/db.js builds its pool with the schema-scoped URL.
const { migrate } = await import("../../src/migrate.js");
const { pool } = await import("../../src/db.js");

const admin = new pg.Client({ connectionString: adminUrl });
let fixtureDir: string;

async function tableExists(name: string): Promise<boolean> {
  const result = await admin.query<{ reg: string | null }>("SELECT to_regclass($1) AS reg", [
    `${schemaName}.${name}`
  ]);
  return result.rows[0]!.reg !== null;
}

async function appliedMigrations(): Promise<string[]> {
  const result = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY applied_at, name");
  return result.rows.map((row) => row.name);
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  fixtureDir = await mkdtemp(path.join(tmpdir(), "migrations-fixture-"));
  await writeFile(path.join(fixtureDir, "001_one.sql"), "CREATE TABLE fixture_one (id int PRIMARY KEY);\n");
  await writeFile(
    path.join(fixtureDir, "002_two.sql"),
    "CREATE TABLE fixture_two (id int PRIMARY KEY);\nINSERT INTO fixture_two VALUES (1);\n"
  );
  await writeFile(path.join(fixtureDir, "notes.txt"), "not a migration\n");
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await pool.end();
});

describe("migration runner", () => {
  it("applies pending .sql migrations in name order and records them", async () => {
    await migrate(fixtureDir);
    expect(await appliedMigrations()).toEqual(["001_one.sql", "002_two.sql"]);
    expect(await tableExists("fixture_one")).toBe(true);
    expect(await tableExists("fixture_two")).toBe(true);
  });

  it("skips already-applied migrations on a second run", async () => {
    await migrate(fixtureDir);
    expect(await appliedMigrations()).toEqual(["001_one.sql", "002_two.sql"]);
    // 002 inserts a row; a re-run must not have executed it again.
    const rows = await pool.query("SELECT count(*)::int AS count FROM fixture_two");
    expect(rows.rows[0]).toEqual({ count: 1 });
  });

  it("rolls back a failing migration and rethrows without recording it", async () => {
    await writeFile(
      path.join(fixtureDir, "003_broken.sql"),
      "CREATE TABLE fixture_three (id int PRIMARY KEY);\nINSERT INTO no_such_table VALUES (1);\n"
    );
    await expect(migrate(fixtureDir)).rejects.toThrow(/no_such_table/);
    // The whole file rolled back — including the successful first statement.
    expect(await tableExists("fixture_three")).toBe(false);
    expect(await appliedMigrations()).toEqual(["001_one.sql", "002_two.sql"]);
  });

  it("recovers once the failing migration is fixed", async () => {
    await writeFile(path.join(fixtureDir, "003_broken.sql"), "CREATE TABLE fixture_three (id int PRIMARY KEY);\n");
    await migrate(fixtureDir);
    expect(await appliedMigrations()).toEqual(["001_one.sql", "002_two.sql", "003_broken.sql"]);
    expect(await tableExists("fixture_three")).toBe(true);
  });
});
