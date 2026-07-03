import { describe, it, expect } from "vitest";
import { tintForHour, phaseForHour, normalizeHour } from "./dayNight";

describe("normalizeHour", () => {
  it.each([
    [0, 0],
    [12, 12],
    [24, 0],
    [25, 1],
    [-1, 23],
    [-25, 23],
  ])("wraps %p to %p", (input, out) => {
    expect(normalizeHour(input)).toBe(out);
  });
});

describe("tintForHour", () => {
  it("is fully clear at midday", () => {
    expect(tintForHour(12).alpha).toBe(0);
  });

  it("is darkest in the dead of night", () => {
    expect(tintForHour(0).alpha).toBeGreaterThan(0.4);
    expect(tintForHour(2).alpha).toBeGreaterThan(0.4);
  });

  it("dusk is warmer and lighter than deep night", () => {
    const dusk = tintForHour(18.5);
    const night = tintForHour(0);
    expect(dusk.alpha).toBeLessThan(night.alpha);
    // amber dusk has more red than the blue night tint
    expect((dusk.color >> 16) & 0xff).toBeGreaterThan((night.color >> 16) & 0xff);
  });

  it("keeps colour channels in range and alpha within [0, 0.5] for every hour", () => {
    for (let h = 0; h <= 24; h += 0.25) {
      const { color, alpha } = tintForHour(h);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(0.5);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("wraps continuously at the 24h boundary", () => {
    expect(tintForHour(24)).toEqual(tintForHour(0));
  });
});

describe("phaseForHour", () => {
  it.each([
    [0, "night"],
    [3, "night"],
    [7, "dawn"],
    [12, "day"],
    [16.5, "day"],
    [19, "dusk"],
    [22, "night"],
  ] as const)("hour %p -> %s", (h, phase) => {
    expect(phaseForHour(h)).toBe(phase);
  });
});
