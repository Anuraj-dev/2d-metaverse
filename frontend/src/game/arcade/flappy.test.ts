import { describe, it, expect } from "vitest";
import {
  initFlappy,
  flappyFlap,
  flappyTick,
  flappyResize,
  DEFAULT_FLAPPY_CONFIG,
  FLAPPY_STEP,
  type FlappyState,
} from "./flappy";

describe("initFlappy", () => {
  it("starts on the ready screen with no pipes", () => {
    const s = initFlappy(1);
    expect(s.phase).toBe("ready");
    expect(s.pipes).toHaveLength(0);
    expect(s.score).toBe(0);
    expect(s.birdY).toBeCloseTo(s.groundY * 0.46);
    expect(s.groundY).toBe(
      DEFAULT_FLAPPY_CONFIG.height - DEFAULT_FLAPPY_CONFIG.groundHeight
    );
  });
});

describe("flappyTick — ready screen", () => {
  it("bobs in place, drifts the backdrop, and spawns nothing", () => {
    let s = initFlappy(1);
    const base = s.groundY * 0.46;
    for (let i = 0; i < 200; i++) s = flappyTick(s);
    expect(s.phase).toBe("ready");
    expect(s.pipes).toHaveLength(0);
    expect(s.vy).toBe(0);
    expect(Math.abs(s.birdY - base)).toBeLessThanOrEqual(13.001);
    expect(s.scroll).toBeGreaterThan(0);
  });
});

describe("flappyFlap", () => {
  it("starts the run and lays the first pipes out ahead", () => {
    const s = flappyFlap(initFlappy(1));
    expect(s.phase).toBe("play");
    expect(s.vy).toBe(DEFAULT_FLAPPY_CONFIG.flapVelocity);
    expect(s.pipes.length).toBeGreaterThan(0);
    for (const pipe of s.pipes) expect(pipe.x).toBeGreaterThan(s.width);
  });

  it("sets upward velocity mid-run without re-laying the field", () => {
    const started = flappyFlap(initFlappy(1));
    const falling: FlappyState = { ...started, vy: 400 };
    const flapped = flappyFlap(falling);
    expect(flapped.vy).toBe(DEFAULT_FLAPPY_CONFIG.flapVelocity);
    expect(flapped.pipes).toBe(falling.pipes);
  });

  it("is ignored while tumbling or once over", () => {
    const dying: FlappyState = { ...initFlappy(1), phase: "dying" };
    const over: FlappyState = { ...initFlappy(1), phase: "over" };
    expect(flappyFlap(dying)).toBe(dying);
    expect(flappyFlap(over)).toBe(over);
  });
});

describe("flappyTick — gravity", () => {
  it("integrates gravity into velocity and position", () => {
    const s = flappyFlap(initFlappy(1));
    const next = flappyTick(s);
    expect(next.vy).toBeCloseTo(s.vy + s.gravity * FLAPPY_STEP);
    expect(next.birdY).toBeCloseTo(s.birdY + next.vy * FLAPPY_STEP);
  });

  it("eventually falls to the ground and ends the run", () => {
    let s = flappyFlap(initFlappy(1));
    for (let i = 0; i < 2000 && s.phase !== "over"; i++) s = flappyTick(s);
    expect(s.phase).toBe("over");
    expect(s.birdY).toBeCloseTo(s.groundY - s.birdRadius);
  });
});

describe("flappyTick — collision", () => {
  it("tumbles after punching through the ceiling", () => {
    const base = initFlappy(1);
    let s: FlappyState = { ...base, phase: "play", birdY: base.ceiling + 5, vy: -900 };
    s = flappyTick(s);
    expect(s.phase).toBe("dying");
  });

  it("tumbles into a pipe and then settles into over", () => {
    const base = initFlappy(1);
    let s: FlappyState = {
      ...base,
      phase: "play",
      birdY: 60,
      vy: 0,
      pipes: [{ x: base.birdX - 10, top: 300, gap: base.gapStart, scored: false }],
    };
    s = flappyTick(s);
    expect(s.phase).toBe("dying");
    for (let i = 0; i < 2000 && s.phase !== "over"; i++) s = flappyTick(s);
    expect(s.phase).toBe("over");
  });

  it("flies cleanly through the gap and scores", () => {
    const base = initFlappy(1);
    // No gravity: the bird holds its line while the pipe scrolls past it.
    let s: FlappyState = {
      ...base,
      phase: "play",
      gravity: 0,
      vy: 0,
      birdY: 400,
      pipes: [
        { x: base.birdX + 4, top: 400 - base.gapStart / 2, gap: base.gapStart, scored: false },
      ],
    };
    for (let i = 0; i < 120 && s.phase === "play"; i++) s = flappyTick(s);
    expect(s.phase).toBe("play");
    expect(s.score).toBe(10);
  });
});

describe("flappyTick — pipe field", () => {
  it("tightens the gap along the ramp, plateauing at the end config", () => {
    const base = initFlappy(1);
    const spawn = (score: number) =>
      flappyTick({ ...base, phase: "play", gravity: 0, score, pipes: [] }).pipes[0];
    expect(spawn(0)?.gap).toBeCloseTo(base.gapStart);
    expect(spawn(200)?.gap).toBeCloseTo((base.gapStart + base.gapEnd) / 2);
    expect(spawn(400)?.gap).toBeCloseTo(base.gapEnd);
    expect(spawn(1000)?.gap).toBeCloseTo(base.gapEnd);
  });

  it("drops pipes once they scroll off the left edge", () => {
    const base = initFlappy(1);
    let s: FlappyState = {
      ...base,
      phase: "play",
      gravity: 0,
      vy: 0,
      birdY: 400,
      pipes: [{ x: -200, top: 300, gap: base.gapStart, scored: true }],
    };
    s = flappyTick(s);
    // The stale column is gone; only the freshly spawned one ahead remains.
    expect(s.pipes.every((p) => p.x > 0)).toBe(true);
  });
});

describe("flappyResize", () => {
  it("keeps the ground thickness and re-centres the ready bird", () => {
    const base = initFlappy(1);
    const thickness = base.height - base.groundY;
    const s = flappyResize(base, 1400, 700);
    expect(s.width).toBe(1400);
    expect(s.height).toBe(700);
    expect(s.height - s.groundY).toBe(thickness);
    expect(s.birdX).toBeCloseTo(1400 * DEFAULT_FLAPPY_CONFIG.birdXFrac);
    expect(s.birdY).toBeCloseTo(s.groundY * 0.46);
  });

  it("is a no-op at the same size", () => {
    const base = initFlappy(1);
    expect(flappyResize(base, base.width, base.height)).toBe(base);
  });

  it("keeps a live run going, clear of a raised ground", () => {
    const started: FlappyState = { ...flappyFlap(initFlappy(1)), birdY: 640 };
    const s = flappyResize(started, 900, 500);
    expect(s.phase).toBe("play");
    expect(s.birdY).toBeLessThan(s.groundY - s.birdRadius);
    // Same columns, each keeping its distance to the bird and still passable
    // inside the shorter play area.
    expect(s.pipes).toHaveLength(started.pipes.length);
    s.pipes.forEach((pipe, i) => {
      expect(pipe.x - s.birdX).toBeCloseTo(
        (started.pipes[i]?.x ?? Number.NaN) - started.birdX
      );
      expect(pipe.top + pipe.gap).toBeLessThanOrEqual(s.groundY);
    });
  });

  it("preserves bird↔pipe distances mid-run — a pure resize cannot collide or score", () => {
    const base = initFlappy(1);
    // An unscored column just ahead of the bird: the old absolute-x resize
    // would teleport the widened bird into (or past) it.
    const started: FlappyState = {
      ...base,
      phase: "play",
      gravity: 0,
      vy: 0,
      birdY: 400,
      pipes: [
        { x: base.birdX + 30, top: 300, gap: 200, scored: false },
        { x: base.birdX + 30 + base.spacingStart, top: 260, gap: 200, scored: false },
      ],
    };

    const wide = flappyResize(started, 1400, base.height);
    expect(wide.phase).toBe("play");
    expect(wide.score).toBe(0);
    expect(wide.pipes).toHaveLength(started.pipes.length);
    wide.pipes.forEach((pipe, i) => {
      expect(pipe.x - wide.birdX).toBeCloseTo(
        (started.pipes[i]?.x ?? Number.NaN) - started.birdX
      );
      expect(pipe.scored).toBe(false);
    });
    // The tick after a pure resize neither crashes nor awards an unearned point.
    const next = flappyTick(wide);
    expect(next.phase).toBe("play");
    expect(next.score).toBe(0);

    // Narrowing preserves the distances too.
    const narrow = flappyResize(started, 900, base.height);
    narrow.pipes.forEach((pipe, i) => {
      expect(pipe.x - narrow.birdX).toBeCloseTo(
        (started.pipes[i]?.x ?? Number.NaN) - started.birdX
      );
    });
  });
});

describe("determinism", () => {
  function run(seed: number): FlappyState {
    let s = flappyFlap(initFlappy(seed));
    // Flap every 40 steps; this drives a full seeded run incl. pipe spawns.
    for (let i = 0; i < 2000 && s.phase !== "over"; i++) {
      if (i % 40 === 0) s = flappyFlap(s);
      s = flappyTick(s);
    }
    return s;
  }
  it("same seed + flap script ⇒ identical outcome", () => {
    expect(run(555)).toEqual(run(555));
  });
  it("different seeds diverge", () => {
    expect(run(555).pipes).not.toEqual(run(777).pipes);
  });
});
