import { describe, it, expect } from "vitest";
import { fitScale } from "./minimapScale";

describe("fitScale", () => {
  it("is width-constrained for the campus map", () => {
    const s = fitScale(1280, 896, 184, 132);
    expect(s).toBeCloseTo(184 / 1280);
    expect(1280 * s).toBeLessThanOrEqual(184 + 1e-9);
    expect(896 * s).toBeLessThanOrEqual(132 + 1e-9);
  });

  it("is height-constrained for tall worlds", () => {
    const s = fitScale(100, 400, 184, 132);
    expect(s).toBeCloseTo(132 / 400);
  });

  it("guards against zero/negative dimensions", () => {
    expect(fitScale(0, 100)).toBe(1);
    expect(fitScale(100, -5)).toBe(1);
  });
});
