import { describe, it, expect } from "vitest";
import {
  FLAPPY_NEAR_MISS_PX,
  flappyGapClearance,
  flappyNearMiss,
  snakeHeadPressure,
  snakeNearMiss,
} from "./feedback";
import { initFlappy, type FlappyState } from "./flappy";
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
  return { ...initFlappy(1), phase: "play", ...partial };
}

describe("flappy near miss", () => {
  const base = initFlappy(1);

  it("is null between pipes", () => {
    expect(flappyGapClearance(flappy({ pipes: [] }))).toBeNull();
    expect(
      flappyGapClearance(
        flappy({ pipes: [{ x: base.birdX + 100, top: 50, gap: 200, scored: false }] })
      )
    ).toBeNull();
  });

  it("flags a safe tight squeeze but not comfortable, colliding, or terminal states", () => {
    const overlapping = base.birdX - base.pipeWidth / 2;
    const tight = flappy({
      pipes: [{ x: overlapping, top: 50, gap: 200, scored: false }],
      birdY: 50 + base.birdRadius + 4,
    });
    expect(flappyGapClearance(tight)).toBe(4);
    expect(flappyNearMiss(tight)).toBe(true);
    expect(flappyNearMiss(tight, 4)).toBe(false);
    expect(flappyNearMiss(tight, FLAPPY_NEAR_MISS_PX + 5)).toBe(true);

    expect(flappyNearMiss({ ...tight, birdY: 150 })).toBe(false);
    expect(flappyNearMiss({ ...tight, birdY: 20 })).toBe(false);
    expect(flappyNearMiss({ ...tight, phase: "dying" })).toBe(false);
  });
});
