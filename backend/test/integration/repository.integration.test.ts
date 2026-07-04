import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { hashSecret, verifySecret } from "../../src/password.js";
import { getRoom, getSeatIds, getSpace, seatExists, spaceExists } from "../../src/repository.js";
import { seed } from "../../src/seed.js";
import { uniqueName } from "./helpers.js";

beforeAll(async () => {
  await migrate();
  await seed();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE username LIKE 'it%\\_repo%'");
  await pool.end();
});

describe("spaces and rooms", () => {
  it("spaceExists distinguishes seeded from unknown spaces", async () => {
    expect(await spaceExists("1")).toBe(true);
    expect(await spaceExists("does-not-exist")).toBe(false);
  });

  it("getSpace returns the map URL and all six rooms with seats", async () => {
    const space = await getSpace("1");
    expect(space).not.toBeNull();
    expect(typeof space!.mapJsonUrl).toBe("string");
    expect(space!.rooms).toHaveLength(6);
    // Hostel rooms 1-3 have capacities 5/8/12 (PRD 13); HQ rooms 4-6 keep four.
    const expectedSeats: Record<string, number> = { "1": 5, "2": 8, "3": 12, "4": 4, "5": 4, "6": 4 };
    for (const room of space!.rooms) {
      expect(room.seats).toHaveLength(expectedSeats[room.id] ?? 4);
      expect(room.doorZone).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number)
      });
      for (const seat of room.seats) {
        expect(["down", "left", "right", "up"]).toContain(seat.facing);
      }
    }
    expect(await getSpace("does-not-exist")).toBeNull();
  });

  it("getRoom returns capacity and a key hash that verifies the room key", async () => {
    const room = await getRoom("3");
    expect(room).toMatchObject({ id: "3", spaceId: "1", capacity: 12 });
    expect(await verifySecret(process.env.ROOM_3_KEY!, room!.keyHash)).toBe(true);
    expect(await verifySecret("wrong-key", room!.keyHash)).toBe(false);
    expect(await getRoom("does-not-exist")).toBeNull();
  });

  it("seatExists and getSeatIds reflect the seeded seat layout", async () => {
    expect(await seatExists("3", 0)).toBe(true);
    expect(await seatExists("3", 99)).toBe(false);
    expect(await seatExists("does-not-exist", 0)).toBe(false);
    expect(await getSeatIds("3")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(await getSeatIds("does-not-exist")).toEqual([]);
  });
});

describe("users against the real schema", () => {
  it("creates and finds a user, hashing round-trips, and duplicates raise 23505", async () => {
    const username = uniqueName("repo1");
    const passwordHash = await hashSecret("repository-password-1");
    const inserted = await pool.query<{ id: string }>(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
      [username, passwordHash]
    );
    expect(inserted.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);

    const found = await pool.query<{ username: string; password_hash: string }>(
      "SELECT username, password_hash FROM users WHERE username = $1",
      [username]
    );
    expect(found.rowCount).toBe(1);
    expect(await verifySecret("repository-password-1", found.rows[0]!.password_hash)).toBe(true);

    await expect(
      pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [username, passwordHash])
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces lowercase usernames at the schema level", async () => {
    await expect(
      pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [
        uniqueName("repo2").toUpperCase(),
        await hashSecret("repository-password-2")
      ])
    ).rejects.toMatchObject({ code: "23514" }); // check constraint violation
  });
});
