import { describe, it, expect } from "vitest";
import {
  FLAPPY_NEAR_MISS_PX,
  flappyGapClearance,
  flappyNearMiss,
  isNewBest,
  snakeHeadPressure,
  snakeNearMiss,
} from "./feedback";
import { DEFAULT_FLAPPY_CONFIG, initFlappy, type FlappyState } from "./flappy";
import type { SnakeState } from "./snake";

function snake(partial: Partial<SnakeState>): SnakeState {
  return {
    width: 10,
    height: 10,
    body: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    dir: "right",
    pendingDir: null,
    food: { x: 9, y: 9 },
    walls: [],
    levelId: "open",
    alive: true,
    won: false,
    score: 0,
    rngSeed: 1,
    ...partial,
  };
}

describe("snakeHeadPressure", () => {
  const cases: Array<{ name: string; state: SnakeState; pressure: number }> = [
    { name: "open floor", state: snake({}), pressure: 0 },
    {
      name: "hugging the top edge",
      state: snake({ body: [{ x: 5, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 0 }] }),
      pressure: 1,
    },
    {
      name: "in a top-left corner",
      state: snake({ body: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }], dir: "up" }),
      pressure: 2,
    },
    {
      name: "threading a one-cell wall gap",
      state: snake({
        walls: [
          { x: 5, y: 4 },
          { x: 5, y: 6 },
        ],
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      }),
      pressure: 2,
    },
    {
      name: "boxed in on three sides",
      state: snake({
        walls: [
          { x: 5, y: 4 },
          { x: 5, y: 6 },
          { x: 6, y: 5 },
        ],
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      }),
      pressure: 3,
    },
  ];
  for (const { name, state, pressure } of cases) {
    it(`${name} ⇒ pressure ${pressure}`, () => {
      expect(snakeHeadPressure(state)).toBe(pressure);
      expect(snakeNearMiss(state)).toBe(pressure >= 2);
    });
  }

  it("ignores the vacating tail cell", () => {
    // Head at (5,5); the tail sits directly above but moves away next tick.
    const s = snake({
      body: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 4 },
        { x: 5, y: 4 },
      ],
    });
    expect(snakeHeadPressure(s)).toBe(0);
  });

  it("counts a non-tail body segment beside the head", () => {
    const s = snake({
      body: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 6 },
      ],
    });
    // (5,4) is now a mid-body cell that stays put ⇒ pressure 1.
    expect(snakeHeadPressure(s)).toBe(1);
  });

  it("is 0 for terminal states", () => {
    expect(snakeHeadPressure(snake({ alive: false }))).toBe(0);
    expect(snakeHeadPressure(snake({ won: true }))).toBe(0);
  });
});

function flappy(partial: Partial<FlappyState>): FlappyState {
  return { ...initFlappy(1), ...partial };
}

describe("flappy near miss", () => {
  const { pipeWidth, pipeGap, birdX, birdRadius } = DEFAULT_FLAPPY_CONFIG;

  it("is null between pipes", () => {
    expect(flappyGapClearance(flappy({ pipes: [] }))).toBeNull();
    // A pipe far to the right does not overlap the bird.
    expect(
      flappyGapClearance(flappy({ pipes: [{ x: birdX + 100, gapY: 50, scored: false }] }))
    ).toBeNull();
  });

  it("measures the smaller of the two gap-edge clearances", () => {
    // Gap 50..50+pipeGap; bird centred at 80 with radius 8 ⇒ top edge 72,
    // bottom edge 88 ⇒ clearances 22 and pipeGap - 38.
    const s = flappy({
      pipes: [{ x: birdX - pipeWidth / 2, gapY: 50, scored: false }],
      birdY: 80,
    });
    expect(flappyGapClearance(s)).toBe(Math.min(72 - 50, 50 + pipeGap - 88));
  });

  it("flags a tight squeeze and not a comfortable one", () => {
    const tight = flappy({
      pipes: [{ x: birdX - pipeWidth / 2, gapY: 50, scored: false }],
      // Sitting just below the top lip: clearance 4px.
      birdY: 50 + birdRadius + 4,
    });
    expect(flappyNearMiss(tight)).toBe(true);

    const comfy = flappy({
      pipes: [{ x: birdX - pipeWidth / 2, gapY: 50, scored: false }],
      birdY: 50 + pipeGap / 2,
    });
    expect(flappyNearMiss(comfy)).toBe(false);
  });

  it("does not flag a dead bird or a negative (inside-pipe) clearance", () => {
    const inside = flappy({
      pipes: [{ x: birdX - pipeWidth / 2, gapY: 50, scored: false }],
      birdY: 20,
    });
    expect(flappyGapClearance(inside)).toBeLessThan(0);
    expect(flappyNearMiss(inside)).toBe(false);

    const dead = flappy({
      pipes: [{ x: birdX - pipeWidth / 2, gapY: 50, scored: false }],
      birdY: 50 + birdRadius + 2,
      alive: false,
    });
    expect(flappyNearMiss(dead)).toBe(false);
  });

  it("respects a custom threshold", () => {
    const s = flappy({
      pipes: [{ x: birdX - pipeWidth / 2, gapY: 50, scored: false }],
      birdY: 50 + birdRadius + FLAPPY_NEAR_MISS_PX + 2,
    });
    expect(flappyNearMiss(s)).toBe(false);
    expect(flappyNearMiss(s, FLAPPY_NEAR_MISS_PX + 5)).toBe(true);
  });

  it("takes the tightest pipe when two overlap the bird", () => {
    const s = flappy({
      pipes: [
        { x: birdX - pipeWidth, gapY: 40, scored: false },
        { x: birdX + birdRadius - 2, gapY: 90, scored: false },
      ],
      birdY: 100,
    });
    const clearance = flappyGapClearance(s);
    expect(clearance).not.toBeNull();
    expect(clearance).toBe(
      Math.min(
        Math.min(100 - birdRadius - 40, 40 + pipeGap - (100 + birdRadius)),
        Math.min(100 - birdRadius - 90, 90 + pipeGap - (100 + birdRadius))
      )
    );
  });
});

describe("isNewBest", () => {
  const cases: Array<{ score: number; best: number | null; expected: boolean }> = [
    { score: 5, best: 3, expected: true },
    { score: 3, best: 3, expected: false },
    { score: 2, best: 3, expected: false },
    // No standing best yet (empty leaderboard, or the fetch failed).
    { score: 1, best: null, expected: true },
    // A scoreless run is never a personal best, even on a fresh cabinet.
    { score: 0, best: null, expected: false },
    { score: 0, best: 0, expected: false },
    { score: -1, best: null, expected: false },
    { score: 1, best: 0, expected: true },
  ];
  for (const { score, best, expected } of cases) {
    it(`score ${score} against best ${best ?? "none"} ⇒ ${expected}`, () => {
      expect(isNewBest(score, best)).toBe(expected);
    });
  }
});
