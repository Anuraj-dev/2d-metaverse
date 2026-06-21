import { describe, it, expect } from "vitest";
import { proximityVolume } from "./proximity";

describe("proximityVolume", () => {
  it("is full volume when touching", () => {
    expect(proximityVolume(0, 200)).toBe(1);
  });

  it("is silent at the cutoff", () => {
    expect(proximityVolume(200, 200)).toBe(0);
  });

  it("scales linearly in between", () => {
    expect(proximityVolume(100, 200)).toBeCloseTo(0.5);
    expect(proximityVolume(50, 200)).toBeCloseTo(0.75);
  });

  it("clamps beyond the cutoff to 0", () => {
    expect(proximityVolume(1000, 200)).toBe(0);
  });

  it("clamps negatives to full volume", () => {
    expect(proximityVolume(-5, 200)).toBe(1);
  });

  it("returns 0 for a non-positive cutoff", () => {
    expect(proximityVolume(10, 0)).toBe(0);
  });
});
