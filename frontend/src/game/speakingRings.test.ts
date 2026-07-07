import { describe, it, expect } from "vitest";
import { speakingRingIds } from "./speakingRings";

describe("speakingRingIds", () => {
  it("keeps only active speakers that are present", () => {
    const rings = speakingRingIds(["a", "b", "ghost"], ["a", "b", "c"]);
    expect([...rings].sort()).toEqual(["a", "b"]);
  });

  it("returns empty when no one is speaking", () => {
    expect(speakingRingIds([], ["a", "b"]).size).toBe(0);
  });

  it("drops speakers not in the present set", () => {
    expect([...speakingRingIds(["x"], ["a"])]).toEqual([]);
  });

  it("includes self when self is present and speaking", () => {
    const rings = speakingRingIds(["me"], ["me", "other"]);
    expect(rings.has("me")).toBe(true);
  });

  it("accepts Sets for both arguments", () => {
    const rings = speakingRingIds(new Set(["a", "b"]), new Set(["b"]));
    expect([...rings]).toEqual(["b"]);
  });
});
