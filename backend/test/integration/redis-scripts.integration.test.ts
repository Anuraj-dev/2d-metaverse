import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRateLimitExceeded, redis } from "../../src/redis.js";
import { sitPlayer, standPlayer } from "../../src/seat-store.js";
import { sleep } from "./helpers.js";

const runId = `lua${Date.now().toString(36)}`;

beforeAll(async () => {
  if (!redis.isOpen) await redis.connect();
  await redis.flushDb(); // dedicated logical test DB — never assume clean state
});

afterAll(async () => {
  await redis.flushDb();
  await redis.quit();
});

describe("fixed-window rate-limit script", () => {
  it("admits exactly the limit under parallel contention", async () => {
    const key = `${runId}:parallel`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => isRateLimitExceeded(key, 5, 60))
    );
    expect(results.filter((exceeded) => !exceeded)).toHaveLength(5);
    expect(results.filter((exceeded) => exceeded)).toHaveLength(15);
  });

  it("keeps rejecting inside the window and admits again after expiry", async () => {
    const key = `${runId}:window`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await isRateLimitExceeded(key, 3, 1)).toBe(false);
    }
    expect(await isRateLimitExceeded(key, 3, 1)).toBe(true);
    await sleep(1_100);
    expect(await isRateLimitExceeded(key, 3, 1)).toBe(false);
  });

  it("tracks separate keys independently", async () => {
    expect(await isRateLimitExceeded(`${runId}:a`, 1, 60)).toBe(false);
    expect(await isRateLimitExceeded(`${runId}:a`, 1, 60)).toBe(true);
    expect(await isRateLimitExceeded(`${runId}:b`, 1, 60)).toBe(false);
  });
});

describe("seat sit/stand scripts", () => {
  it("lets exactly one player win a seat under parallel contention", async () => {
    const players = Array.from({ length: 8 }, (_, index) => `${runId}-racer-${index}`);
    const results = await Promise.all(players.map((player) => sitPlayer(player, "race-room", 0)));

    const winners = results.filter((result) => result.ok);
    expect(winners).toHaveLength(1);

    const occupant = await redis.get("seat:race-room:0");
    expect(players).toContain(occupant);
    // Every loser was told who beat them.
    for (const result of results.filter((entry) => !entry.ok)) {
      expect(result.occupant).toBe(occupant);
    }
  });

  it("moves a player between seats atomically, freeing the old one", async () => {
    const player = `${runId}-mover`;
    expect((await sitPlayer(player, "move-room", 1)).ok).toBe(true);

    const moved = await sitPlayer(player, "move-room", 2);
    expect(moved.ok).toBe(true);
    expect(moved.previous).toEqual({ roomId: "move-room", seatId: 1 });

    expect(await redis.get("seat:move-room:1")).toBeNull();
    expect(await redis.get("seat:move-room:2")).toBe(player);
  });

  it("re-sitting on the same seat is a no-op success", async () => {
    const player = `${runId}-same`;
    expect((await sitPlayer(player, "same-room", 3)).ok).toBe(true);
    const again = await sitPlayer(player, "same-room", 3);
    expect(again.ok).toBe(true);
    expect(await redis.get("seat:same-room:3")).toBe(player);
  });

  it("stand returns the freed seat and is null when not seated", async () => {
    const player = `${runId}-stander`;
    expect(await standPlayer(player)).toBeNull();

    expect((await sitPlayer(player, "stand-room", 0)).ok).toBe(true);
    expect(await standPlayer(player)).toEqual({ roomId: "stand-room", seatId: 0 });
    expect(await redis.get("seat:stand-room:0")).toBeNull();
    expect(await standPlayer(player)).toBeNull();
  });

  it("stand never frees a seat the player no longer owns", async () => {
    const owner = `${runId}-owner`;
    const usurped = `${runId}-usurped`;
    expect((await sitPlayer(usurped, "steal-room", 0)).ok).toBe(true);
    // Simulate a stale player-seat pointer at a seat now owned by someone else.
    await redis.set(`player-seat:${usurped}`, "seat:steal-room:0");
    await redis.set("seat:steal-room:0", owner);

    await standPlayer(usurped);
    expect(await redis.get("seat:steal-room:0")).toBe(owner);
  });
});
