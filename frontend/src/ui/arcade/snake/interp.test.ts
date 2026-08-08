import { describe, expect, it } from "vitest";
import {
  clampUnit,
  interpolateSnakeBody,
  isSingleTickBodyTransition,
  renderHeading,
} from "./interp";

describe("Snake renderer interpolation", () => {
  it("interpolates head-first segment pairs at mid-tick", () => {
    const previous = [
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];
    const current = [
      { x: 3, y: 1 },
      { x: 2, y: 1 },
    ];

    expect(interpolateSnakeBody(previous, current, 0.5, false)).toEqual([
      { x: 2.5, y: 1 },
      { x: 1.5, y: 1 },
    ]);
  });

  it("keeps a newly grown tail at its stable current cell", () => {
    const previous = [
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];
    const current = [
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];

    expect(interpolateSnakeBody(previous, current, 0.25, false)).toEqual([
      { x: 2.25, y: 1 },
      { x: 1.25, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(isSingleTickBodyTransition(previous, current)).toBe(true);
  });

  it("snaps a multi-tick catch-up frame instead of crossing several cells", () => {
    const previous = [
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];
    const current = [
      { x: 4, y: 1 },
      { x: 3, y: 1 },
    ];

    expect(isSingleTickBodyTransition(previous, current)).toBe(false);
    expect(interpolateSnakeBody(previous, current, 0.25, true)).toBe(current);
  });

  it("turns the rendered heading to the reducer's next legal queued direction", () => {
    expect(renderHeading("right", [])).toBe("right");
    expect(renderHeading("right", ["up"])).toBe("up");
    expect(renderHeading("right", ["up", "left"])).toBe("up");
    // A queued 180 is ignored — the reducer will discard it too.
    expect(renderHeading("right", ["left"])).toBe("right");
    expect(renderHeading("up", ["left", "down"])).toBe("left");
  });

  it("clamps interpolation alpha to the renderable range", () => {
    expect(clampUnit(-0.2)).toBe(0);
    expect(clampUnit(1.4)).toBe(1);
    expect(
      interpolateSnakeBody([{ x: 1, y: 1 }], [{ x: 2, y: 1 }], 3, false)
    ).toEqual([{ x: 2, y: 1 }]);
  });
});
