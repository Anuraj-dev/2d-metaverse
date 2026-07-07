import { describe, it, expect } from "vitest";
import { meterDecay, meterSegments, DEFAULT_METER } from "./micMeter";

describe("meterDecay", () => {
  it("rises fast toward a louder sample (attack)", () => {
    // From silence, one attack step closes 60% of the gap by default.
    expect(meterDecay(0, 1)).toBeCloseTo(DEFAULT_METER.attack, 5);
  });

  it("falls slowly from a quieter sample (decay)", () => {
    // From full, one decay step keeps most of the level.
    expect(meterDecay(1, 0)).toBeCloseTo(1 - DEFAULT_METER.decay, 5);
  });

  it("attack is snappier than decay over the same gap", () => {
    const up = meterDecay(0.2, 0.8) - 0.2;
    const down = 0.8 - meterDecay(0.8, 0.2);
    expect(up).toBeGreaterThan(down);
  });

  it("clamps samples and NaN into 0..1", () => {
    expect(meterDecay(0, 5)).toBeLessThanOrEqual(1);
    expect(meterDecay(0, -3)).toBe(0);
    expect(meterDecay(Number.NaN, 0.5)).toBeGreaterThanOrEqual(0);
    expect(meterDecay(0.5, Number.NaN)).toBeLessThanOrEqual(0.5);
  });
});

describe("meterSegments", () => {
  it.each([
    [0, 5, 0],
    [1, 5, 5],
    [0.5, 4, 2],
    [0.5, 5, 3],
    [0.1, 5, 1],
    [2, 5, 5],
    [-1, 5, 0],
  ])("level %s over %s segments -> %s lit", (level, count, lit) => {
    expect(meterSegments(level, count)).toBe(lit);
  });

  it("is 0 for a non-positive segment count", () => {
    expect(meterSegments(1, 0)).toBe(0);
  });
});
