import { describe, it, expect } from "vitest";
import { nextFloat, nextInt, toSeed } from "./prng";

describe("prng", () => {
  it("is deterministic: same seed ⇒ same stream", () => {
    const a: number[] = [];
    const b: number[] = [];
    let sa = 12345;
    let sb = 12345;
    for (let i = 0; i < 8; i++) {
      const ra = nextFloat(sa);
      const rb = nextFloat(sb);
      a.push(ra.value);
      b.push(rb.value);
      sa = ra.seed;
      sb = rb.seed;
    }
    expect(a).toEqual(b);
  });

  it("different seeds ⇒ different streams", () => {
    expect(nextFloat(1).value).not.toBe(nextFloat(2).value);
  });

  it("nextFloat stays in [0, 1)", () => {
    let seed = 99;
    for (let i = 0; i < 200; i++) {
      const r = nextFloat(seed);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      seed = r.seed;
    }
  });

  it("nextInt stays in [0, maxExclusive)", () => {
    let seed = 7;
    for (let i = 0; i < 200; i++) {
      const r = nextInt(seed, 5);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(5);
      expect(Number.isInteger(r.value)).toBe(true);
      seed = r.seed;
    }
  });

  it("nextInt with non-positive bound returns 0 but advances the seed", () => {
    const r = nextInt(42, 0);
    expect(r.value).toBe(0);
    expect(r.seed).toBe(nextFloat(42).seed);
  });

  it("toSeed normalizes to a non-zero 32-bit unsigned integer", () => {
    expect(toSeed(0)).toBe(1);
    expect(toSeed(-1)).toBeGreaterThan(0);
    expect(toSeed(3.9)).toBe(3);
  });
});
