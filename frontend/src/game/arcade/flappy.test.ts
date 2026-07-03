import { describe, it, expect } from "vitest";
import {
  initFlappy,
  flappyFlap,
  flappyTick,
  DEFAULT_FLAPPY_CONFIG,
  type FlappyState,
} from "./flappy";

describe("initFlappy", () => {
  it("starts alive, unstarted, centred, no pipes", () => {
    const s = initFlappy(1);
    expect(s.alive).toBe(true);
    expect(s.started).toBe(false);
    expect(s.pipes).toHaveLength(0);
    expect(s.score).toBe(0);
    expect(s.birdY).toBe(Math.floor(DEFAULT_FLAPPY_CONFIG.height / 2));
  });
});

describe("flappyTick — pre-start hover", () => {
  it("does not fall until the first flap", () => {
    let s = initFlappy(1);
    const y0 = s.birdY;
    s = flappyTick(s);
    s = flappyTick(s);
    expect(s.birdY).toBe(y0);
    expect(s.vy).toBe(0);
    expect(s.pipes).toHaveLength(0);
  });
});

describe("flappyFlap", () => {
  it("sets upward velocity and starts the run", () => {
    const s = flappyFlap(initFlappy(1));
    expect(s.vy).toBe(DEFAULT_FLAPPY_CONFIG.flapVelocity);
    expect(s.started).toBe(true);
  });
  it("is ignored once dead", () => {
    const dead: FlappyState = { ...initFlappy(1), alive: false };
    expect(flappyFlap(dead)).toBe(dead);
  });
});

describe("flappyTick — gravity", () => {
  it("integrates gravity into velocity and position after starting", () => {
    let s = flappyFlap(initFlappy(1));
    const vy0 = s.vy;
    s = flappyTick(s);
    expect(s.vy).toBeCloseTo(vy0 + s.gravity);
  });

  it("eventually falls to the ground and dies", () => {
    let s = flappyFlap(initFlappy(1));
    for (let i = 0; i < 1000 && s.alive; i++) s = flappyTick(s);
    expect(s.alive).toBe(false);
  });
});

describe("flappyTick — collision", () => {
  it("dies hitting the ceiling", () => {
    let s: FlappyState = {
      ...initFlappy(1),
      started: true,
      birdY: 5,
      vy: -20,
    };
    s = flappyTick(s);
    expect(s.alive).toBe(false);
  });

  it("passes cleanly through the gap and scores", () => {
    // Place a single pipe whose gap is centred on the bird; no gravity so it
    // flies straight through as the pipe scrolls past.
    const base = initFlappy(1);
    let s: FlappyState = {
      ...base,
      started: true,
      gravity: 0,
      vy: 0,
      birdY: 160,
      pipes: [{ x: base.birdX + 4, gapY: 160 - base.pipeGap / 2, scored: false }],
      // Push the next spawn far away so it does not interfere.
      tick: 1,
      pipeInterval: 100000,
    };
    for (let i = 0; i < 40 && s.alive; i++) s = flappyTick(s);
    expect(s.alive).toBe(true);
    expect(s.score).toBe(1);
  });

  it("crashes into a pipe outside the gap", () => {
    const base = initFlappy(1);
    let s: FlappyState = {
      ...base,
      started: true,
      gravity: 0,
      vy: 0,
      birdY: 20,
      pipes: [{ x: base.birdX + 2, gapY: 200, scored: false }],
      pipeInterval: 100000,
      tick: 1,
    };
    for (let i = 0; i < 10 && s.alive; i++) s = flappyTick(s);
    expect(s.alive).toBe(false);
  });
});

describe("determinism", () => {
  function run(seed: number): FlappyState {
    let s = flappyFlap(initFlappy(seed));
    // Flap every 20 ticks; this drives a full pseeded run incl. pipe spawns.
    for (let i = 0; i < 300 && s.alive; i++) {
      if (i % 20 === 0) s = flappyFlap(s);
      s = flappyTick(s);
    }
    return s;
  }
  it("same seed + flap script ⇒ identical outcome", () => {
    expect(run(555)).toEqual(run(555));
  });
});
