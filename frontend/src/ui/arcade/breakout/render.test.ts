import { describe, expect, it } from "vitest";
import { BREAKOUT_WIDTH } from "../../../game/arcade/breakout";
import { breakoutHudFontWorld } from "./render";

describe("breakoutHudFontWorld", () => {
  it("keeps the 11px design size on a desktop-width canvas", () => {
    expect(breakoutHudFontWorld(BREAKOUT_WIDTH, 900)).toBe(11);
    expect(breakoutHudFontWorld(BREAKOUT_WIDTH, 0)).toBe(11);
  });

  it("grows so HUD paints at least 12 CSS px on a 390-wide cabinet", () => {
    const world = breakoutHudFontWorld(BREAKOUT_WIDTH, 390);
    expect(world * (390 / BREAKOUT_WIDTH)).toBeGreaterThanOrEqual(12);
    expect(world).toBeGreaterThan(11);
  });
});
