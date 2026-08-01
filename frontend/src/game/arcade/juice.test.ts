import { describe, it, expect } from "vitest";
import {
  MAX_PARTICLES,
  SHAKE_MAX_PX,
  burst,
  fadeAlpha,
  initJuice,
  popup,
  shake,
  shakeOffset,
  stepJuice,
  type JuiceState,
} from "./juice";

const BURST = {
  x: 10,
  y: 20,
  count: 8,
  color: "#8ff0d6",
  speed: 3,
  life: 400,
} as const;

function run(seed: number): JuiceState {
  let j = initJuice(seed);
  j = burst(j, BURST);
  j = stepJuice(j, 16);
  j = popup(j, { x: 5, y: 5, text: "+1" });
  j = burst(j, { ...BURST, x: 40, direction: Math.PI / 2, spread: 0.4 });
  j = shake(j, 0.6);
  for (let i = 0; i < 5; i++) j = stepJuice(j, 16);
  return j;
}

describe("determinism", () => {
  it("same seed + same call sequence ⇒ identical state", () => {
    expect(run(1234)).toEqual(run(1234));
  });

  it("different seeds diverge", () => {
    expect(run(1)).not.toEqual(run(2));
  });

  it("never consults Math.random (frozen Math.random still reproduces)", () => {
    const original = Math.random;
    try {
      // Any call would return a constant and collapse the two runs together
      // only if the module depended on it; instead we assert the runs still
      // match the un-stubbed run.
      const expected = run(99);
      Math.random = () => 0.5;
      expect(run(99)).toEqual(expected);
    } finally {
      Math.random = original;
    }
  });

  it("reading the shake offset does not advance the PRNG", () => {
    const j = shake(burst(initJuice(7), BURST), 0.5);
    const before = j.rngSeed;
    shakeOffset(j);
    shakeOffset(j);
    expect(j.rngSeed).toBe(before);
  });
});

describe("burst", () => {
  it("spawns `count` particles that move and expire", () => {
    let j = burst(initJuice(5), BURST);
    expect(j.particles).toHaveLength(BURST.count);
    const first = j.particles[0];
    if (!first) throw new Error("expected a particle");
    j = stepJuice(j, 16);
    const moved = j.particles[0];
    if (!moved) throw new Error("expected the particle to survive one step");
    expect(moved.x === first.x && moved.y === first.y).toBe(false);
    expect(moved.life).toBeLessThan(first.life);
    // Longest possible life is life * 1.3; stepping past it clears the field.
    j = stepJuice(j, BURST.life * 2);
    expect(j.particles).toHaveLength(0);
  });

  it("honours a directional cone", () => {
    // Straight down (+y), tight cone ⇒ every particle has downward velocity.
    const j = burst(initJuice(3), { ...BURST, count: 24, direction: Math.PI / 2, spread: 0.2 });
    for (const p of j.particles) expect(p.vy).toBeGreaterThan(0);
  });

  it("caps the live particle count", () => {
    let j = initJuice(11);
    for (let i = 0; i < 60; i++) j = burst(j, { ...BURST, count: 10 });
    expect(j.particles.length).toBe(MAX_PARTICLES);
  });
});

describe("popup", () => {
  it("rises and expires", () => {
    let j = popup(initJuice(1), { x: 3, y: 30, text: "+1", life: 100 });
    const first = j.popups[0];
    if (!first) throw new Error("expected a popup");
    expect(first.text).toBe("+1");
    j = stepJuice(j, 50);
    const risen = j.popups[0];
    if (!risen) throw new Error("expected the popup to survive");
    expect(risen.y).toBeLessThan(first.y);
    j = stepJuice(j, 60);
    expect(j.popups).toHaveLength(0);
  });
});

describe("shake", () => {
  it("clamps energy to 0..1 and decays to a hard zero", () => {
    expect(shake(initJuice(1), 5).shake).toBe(1);
    expect(shake(initJuice(1), -5).shake).toBe(0);
    let j = shake(initJuice(1), 1);
    j = stepJuice(j, 100);
    expect(j.shake).toBeGreaterThan(0);
    expect(j.shake).toBeLessThan(1);
    j = stepJuice(j, 1000);
    expect(j.shake).toBe(0);
    expect(shakeOffset(j)).toEqual({ x: 0, y: 0 });
  });

  it("offset magnitude scales with energy and stays within bounds", () => {
    const strong = shake(initJuice(1), 1);
    const off = shakeOffset(strong);
    expect(Math.abs(off.x)).toBeLessThanOrEqual(SHAKE_MAX_PX);
    expect(Math.abs(off.y)).toBeLessThanOrEqual(SHAKE_MAX_PX);
    // Energy 0.25 can never exceed a quarter of the maximum swing.
    const weak = shake(initJuice(1), 0.25);
    expect(Math.abs(shakeOffset(weak).x)).toBeLessThanOrEqual(SHAKE_MAX_PX * 0.25);
  });

  it("wobbles over time rather than holding a constant offset", () => {
    const a = shake(initJuice(1), 1);
    const b = stepJuice(a, 40);
    expect(shakeOffset(b)).not.toEqual(shakeOffset(a));
  });
});

describe("stepJuice", () => {
  it("treats a negative or zero dt as a no-op step", () => {
    const j = burst(initJuice(2), BURST);
    expect(stepJuice(j, -50).elapsedMs).toBe(0);
    expect(stepJuice(j, 0).particles).toHaveLength(BURST.count);
  });

  it("advances the clock", () => {
    expect(stepJuice(stepJuice(initJuice(1), 16), 16).elapsedMs).toBe(32);
  });
});

describe("fadeAlpha", () => {
  it("goes 1 → 0 over a lifetime and never leaves 0..1", () => {
    expect(fadeAlpha(100, 100)).toBe(1);
    expect(fadeAlpha(50, 100)).toBeCloseTo(0.5);
    expect(fadeAlpha(-10, 100)).toBe(0);
    expect(fadeAlpha(200, 100)).toBe(1);
    expect(fadeAlpha(1, 0)).toBe(0);
  });
});
