import { describe, it, expect } from "vitest";
import {
  FLAPPY_NEAR_MISS_PX,
  flappyGapClearance,
  flappyNearMiss,
} from "./feedback";
import { initFlappy, type FlappyState } from "./flappy";

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
