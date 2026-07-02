import { describe, it, expect } from "vitest";
import { interpolateStep, REMOTE_LERP } from "./interpolation";

describe("interpolateStep", () => {
  const cases: Array<[string, { x: number; y: number }, { x: number; y: number }, number, number, boolean]> = [
    ["eases 20% toward target on x", { x: 0, y: 0 }, { x: 100, y: 0 }, 20, 0, true],
    ["eases 20% toward target on y", { x: 0, y: 0 }, { x: 0, y: 50 }, 0, 10, true],
    ["eases on both axes", { x: 0, y: 0 }, { x: 100, y: 200 }, 20, 40, true],
    ["already at target → no move", { x: 5, y: 5 }, { x: 5, y: 5 }, 5, 5, false],
  ];
  it.each(cases)("%s", (_l, cur, target, x, y, moving) => {
    const step = interpolateStep(cur, target);
    expect(step.x).toBeCloseTo(x);
    expect(step.y).toBeCloseTo(y);
    expect(step.moving).toBe(moving);
  });

  it("treats a sub-epsilon gap as not moving but still nudges the position", () => {
    const step = interpolateStep({ x: 0, y: 0 }, { x: 0.4, y: 0.4 });
    expect(step.moving).toBe(false);
    expect(step.x).toBeCloseTo(0.4 * REMOTE_LERP);
  });

  it("treats a gap above epsilon on a single axis as moving", () => {
    expect(interpolateStep({ x: 0, y: 0 }, { x: 0.6, y: 0 }).moving).toBe(true);
  });

  it("converges toward the target over repeated steps", () => {
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 50; i++) p = interpolateStep(p, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(100, 1);
  });

  it("honours a custom lerp factor", () => {
    expect(interpolateStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5).x).toBeCloseTo(50);
  });
});
