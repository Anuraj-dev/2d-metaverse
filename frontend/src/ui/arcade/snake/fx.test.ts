import { describe, expect, it } from "vitest";
import {
  createFx,
  flashOpacity,
  GAME_OVER_DURATION_MS,
  shakeOffset,
  startGameOverFx,
  stepGameOverFx,
} from "./fx";

describe("Snake death shake", () => {
  it("returns no offset when shake is disabled", () => {
    const fx = createFx();
    startGameOverFx(fx);
    expect(shakeOffset(fx, 20, false)).toEqual({ x: 0, y: 0 });
  });

  it("does not settle before the full terminal effect duration", () => {
    const fx = createFx();
    startGameOverFx(fx);

    expect(stepGameOverFx(fx, GAME_OVER_DURATION_MS - 1)).toBe(false);
    expect(fx.animating).toBe(true);
    expect(stepGameOverFx(fx, 1)).toBe(true);
    expect(fx.settled).toBe(true);
  });

  it("suppresses the death flash when motion is disabled", () => {
    const fx = createFx();
    startGameOverFx(fx);

    expect(flashOpacity(fx)).toBeGreaterThan(0);
    expect(flashOpacity(fx, false)).toBe(0);
  });
});
