import { describe, it, expect } from "vitest";
import {
  initSnake,
  snakeInput,
  snakeTick,
  snakeAdvanceTime,
  snakeFrame,
  speedForScore,
  bonusValueFromRemaining,
  bonusSizeFromRemaining,
  DIFFICULTIES,
  DIR_QUEUE_MAX,
  FOOD_SCORE,
  BONUS_LIFETIME_MS,
  BONUS_MAX_VALUE,
  BONUS_MIN_VALUE,
  BONUS_MAX_SIZE,
  BONUS_MIN_SIZE,
  SPEED_CAP,
  SPEED_STEP_POINTS,
  DEFAULT_SNAKE_WIDTH,
  DEFAULT_SNAKE_HEIGHT,
  type Dir,
  type Difficulty,
  type SnakeState,
} from "./snake";

/** Build a controlled state so tests do not depend on food placement. */
function state(partial: Partial<SnakeState>): SnakeState {
  return {
    width: 10,
    height: 10,
    body: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    dir: "right",
    dirQueue: [],
    food: { x: 9, y: 9 },
    bonus: null,
    bonusTickCounter: 0,
    alive: true,
    won: false,
    score: 0,
    speed: DIFFICULTIES.normal.initialSpeed,
    difficulty: "normal",
    rngSeed: 1,
    ...partial,
  };
}

function tick(s: SnakeState) {
  return snakeTick(s);
}

describe("initSnake", () => {
  it("starts alive, length 3, heading right, with food off the body", () => {
    const s = initSnake(1, { width: 12, height: 10 });
    expect(s.alive).toBe(true);
    expect(s.won).toBe(false);
    expect(s.body).toHaveLength(3);
    expect(s.dir).toBe("right");
    expect(s.dirQueue).toEqual([]);
    expect(s.score).toBe(0);
    expect(s.bonus).toBeNull();
    expect(s.body.some((c) => c.x === s.food.x && c.y === s.food.y)).toBe(false);
  });

  it("applies difficulty initial speed", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      const s = initSnake(1, { difficulty: d, width: 12, height: 10 });
      expect(s.difficulty).toBe(d);
      expect(s.speed).toBe(DIFFICULTIES[d].initialSpeed);
    }
  });

  it("defaults to normal difficulty and the fallback board", () => {
    const s = initSnake(42);
    expect(s.difficulty).toBe("normal");
    expect(s.width).toBe(DEFAULT_SNAKE_WIDTH);
    expect(s.height).toBe(DEFAULT_SNAKE_HEIGHT);
    expect(s.speed).toBe(DIFFICULTIES.normal.initialSpeed);
  });

  // The renderer measures the stage and passes cols×rows, so the reducer must
  // be dimension-agnostic: any board size starts centred, in bounds, alive.
  const sizes: Array<{ w: number; h: number }> = [
    { w: 20, h: 12 },
    { w: 34, h: 18 },
    { w: 96, h: 51 },
    { w: 5, h: 5 },
  ];
  for (const { w, h } of sizes) {
    it(`starts centred and in bounds on a ${w}×${h} board`, () => {
      const s = initSnake(7, { width: w, height: h });
      expect(s.width).toBe(w);
      expect(s.height).toBe(h);
      expect(s.body[0]).toEqual({
        x: Math.floor(w / 2),
        y: Math.floor(h / 2),
      });
      for (const c of [...s.body, s.food]) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(w);
        expect(c.y).toBeLessThan(h);
      }
      expect(s.alive).toBe(true);
    });
  }

  it("clamps a degenerate board to the minimum the starting snake needs", () => {
    const s = initSnake(1, { width: 1, height: 0 });
    expect(s.width).toBe(5);
    expect(s.height).toBe(3);
    expect(s.body).toHaveLength(3);
    for (const c of s.body) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("difficulty tuning", () => {
  const cases: Array<{
    difficulty: Difficulty;
    initialSpeed: number;
    speedIncrement: number;
    bonusFrequency: number;
  }> = [
    { difficulty: "easy", initialSpeed: 5, speedIncrement: 0.5, bonusFrequency: 150 },
    { difficulty: "normal", initialSpeed: 7, speedIncrement: 1, bonusFrequency: 180 },
    { difficulty: "hard", initialSpeed: 10, speedIncrement: 1.5, bonusFrequency: 220 },
  ];
  for (const c of cases) {
    it(`${c.difficulty}: initial ${c.initialSpeed}, step ${c.speedIncrement}, bonus every ${c.bonusFrequency}`, () => {
      expect(DIFFICULTIES[c.difficulty]).toEqual({
        initialSpeed: c.initialSpeed,
        speedIncrement: c.speedIncrement,
        bonusFrequency: c.bonusFrequency,
      });
    });
  }

  it("speed steps every 50 points and caps at 15", () => {
    expect(speedForScore(0, "normal")).toBe(7);
    expect(speedForScore(49, "normal")).toBe(7);
    expect(speedForScore(50, "normal")).toBe(8);
    expect(speedForScore(100, "normal")).toBe(9);
    expect(speedForScore(0, "easy")).toBe(5);
    expect(speedForScore(50, "easy")).toBe(5.5);
    expect(speedForScore(0, "hard")).toBe(10);
    expect(speedForScore(50, "hard")).toBe(11.5);
    expect(speedForScore(200, "hard")).toBe(SPEED_CAP);
    expect(speedForScore(1000, "easy")).toBe(SPEED_CAP);
  });
});

describe("snakeInput — 3-deep queue", () => {
  it("buffers the turn without changing the moved direction", () => {
    const s = snakeInput(state({}), "up");
    expect(s.dirQueue).toEqual(["up"]);
    expect(s.dir).toBe("right");
  });

  it("queues multiple inputs up to DIR_QUEUE_MAX", () => {
    let s = state({});
    s = snakeInput(s, "up");
    s = snakeInput(s, "left");
    s = snakeInput(s, "down");
    expect(s.dirQueue).toEqual(["up", "left", "down"]);
    expect(s.dirQueue).toHaveLength(DIR_QUEUE_MAX);
  });

  it("drops the oldest when the queue is full (keeps last 3)", () => {
    let s = state({});
    for (const d of ["up", "left", "down", "right"] as Dir[]) {
      s = snakeInput(s, d);
    }
    expect(s.dirQueue).toEqual(["left", "down", "right"]);
  });

  it("ignores input on a dead or won snake", () => {
    const dead = state({ alive: false });
    expect(snakeInput(dead, "up")).toBe(dead);
    const won = state({ won: true });
    expect(snakeInput(won, "up")).toBe(won);
  });
});

describe("snakeTick — turn resolution (3-deep queue, validated at tick)", () => {
  it("applies a buffered perpendicular turn and drains one queue entry", () => {
    const { state: s, events } = tick(snakeInput(state({}), "up"));
    expect(s.body[0]).toEqual({ x: 5, y: 4 });
    expect(s.dir).toBe("up");
    expect(s.dirQueue).toEqual([]);
    expect(events).toEqual([]);
  });

  it("discards a buffered 180° reversal and keeps moving", () => {
    const { state: s } = tick(snakeInput(state({ dir: "right" }), "left"));
    expect(s.body[0]).toEqual({ x: 6, y: 5 });
    expect(s.dir).toBe("right");
    expect(s.alive).toBe(true);
    expect(s.dirQueue).toEqual([]);
  });

  const bodies: Record<Dir, SnakeState["body"]> = {
    right: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    left: [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ],
    up: [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
    ],
    down: [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ],
  };

  const oneTick: Array<{
    moving: Dir;
    inputs: Dir[];
    expectDir: Dir;
    expectQueue: Dir[];
  }> = [
    { moving: "right", inputs: ["up", "left"], expectDir: "up", expectQueue: ["left"] },
    { moving: "right", inputs: ["down", "left"], expectDir: "down", expectQueue: ["left"] },
    { moving: "right", inputs: ["left", "up"], expectDir: "right", expectQueue: ["up"] },
    { moving: "left", inputs: ["right", "up"], expectDir: "left", expectQueue: ["up"] },
    { moving: "up", inputs: ["down", "left"], expectDir: "up", expectQueue: ["left"] },
    { moving: "down", inputs: ["up", "right"], expectDir: "down", expectQueue: ["right"] },
    {
      moving: "right",
      inputs: ["up", "left", "down"],
      expectDir: "up",
      expectQueue: ["left", "down"],
    },
  ];
  for (const { moving, inputs, expectDir, expectQueue } of oneTick) {
    it(`moving ${moving}, queue [${inputs.join(", ")}] ⇒ one tick moves ${expectDir}`, () => {
      let s = state({ dir: moving, body: bodies[moving] });
      for (const d of inputs) s = snakeInput(s, d);
      const { state: next } = tick(s);
      expect(next.alive).toBe(true);
      expect(next.dir).toBe(expectDir);
      expect(next.dirQueue).toEqual(expectQueue);
    });
  }

  it("drains a legal follow-up turn on the next tick", () => {
    let s = state({
      dir: "right",
      body: bodies.right,
      food: { x: 0, y: 0 },
    });
    s = snakeInput(s, "up");
    s = snakeInput(s, "left");
    s = tick(s).state;
    expect(s.dir).toBe("up");
    s = tick(s).state;
    expect(s.dir).toBe("left");
    expect(s.alive).toBe(true);
    expect(s.dirQueue).toEqual([]);
  });

  it("cannot reverse 180 within a single tick via a multi-step queue", () => {
    let s = state({ dir: "right", body: bodies.right });
    s = snakeInput(s, "up");
    s = snakeInput(s, "left");
    const { state: next } = tick(s);
    expect(next.dir).toBe("up");
    expect(next.dir).not.toBe("left");
  });
});

describe("snakeTick — movement", () => {
  it("slides forward, keeping length (tail removed)", () => {
    const { state: s, events } = tick(state({}));
    expect(s.body[0]).toEqual({ x: 6, y: 5 });
    expect(s.body).toHaveLength(3);
    expect(s.alive).toBe(true);
    expect(events).toEqual([]);
  });

  it("a dead snake is an idempotent no-op", () => {
    const dead = state({ alive: false });
    const step = tick(dead);
    expect(step.state).toBe(dead);
    expect(step.events).toEqual([]);
  });

  it("a won snake is an idempotent no-op", () => {
    const won = state({ won: true });
    const step = tick(won);
    expect(step.state).toBe(won);
    expect(step.events).toEqual([]);
  });
});

describe("snakeTick — walls + die event", () => {
  const cases: Array<{ dir: Dir; body: SnakeState["body"] }> = [
    { dir: "right", body: [{ x: 9, y: 5 }] },
    { dir: "left", body: [{ x: 0, y: 5 }] },
    { dir: "up", body: [{ x: 5, y: 0 }] },
    { dir: "down", body: [{ x: 5, y: 9 }] },
  ];
  for (const { dir, body } of cases) {
    it(`dies moving ${dir} off the edge and emits die`, () => {
      const { state: s, events } = tick(state({ dir, body }));
      expect(s.alive).toBe(false);
      expect(events).toEqual(["die"]);
    });
  }
});

describe("snakeTick — self collision", () => {
  it("dies when the head runs into the body", () => {
    const { state: s, events } = tick(
      state({
        dir: "right",
        body: [
          { x: 5, y: 5 },
          { x: 5, y: 4 },
          { x: 6, y: 4 },
          { x: 6, y: 5 },
          { x: 6, y: 6 },
          { x: 5, y: 6 },
        ],
      })
    );
    expect(s.alive).toBe(false);
    expect(events).toEqual(["die"]);
  });

  it("moving into the vacating tail cell is legal", () => {
    const { state: s } = tick(
      snakeInput(
        state({
          dir: "up",
          body: [
            { x: 5, y: 5 },
            { x: 6, y: 5 },
            { x: 6, y: 4 },
            { x: 5, y: 4 },
          ],
        }),
        "up"
      )
    );
    expect(s.alive).toBe(true);
  });
});

describe("snakeTick — eating + scoring + events", () => {
  it("grows, scores +10, emits eat, then respawns food", () => {
    const { state: next, events } = tick(
      state({
        dir: "right",
        body: [{ x: 4, y: 5 }],
        food: { x: 5, y: 5 },
      })
    );
    expect(next.alive).toBe(true);
    expect(next.won).toBe(false);
    expect(next.score).toBe(FOOD_SCORE);
    expect(next.body).toHaveLength(2);
    expect(next.body[0]).toEqual({ x: 5, y: 5 });
    expect(next.food).not.toEqual({ x: 5, y: 5 });
    expect(events).toEqual(["eat"]);
  });

  it("emits milestone instead of eat when score hits a multiple of 100", () => {
    const { state: next, events } = tick(
      state({
        dir: "right",
        body: [{ x: 4, y: 5 }],
        food: { x: 5, y: 5 },
        score: 90,
      })
    );
    expect(next.score).toBe(100);
    expect(events).toEqual(["milestone"]);
  });

  it("bumps speed every 50 points on normal food, capped", () => {
    const { state: next } = tick(
      state({
        dir: "right",
        body: [{ x: 4, y: 5 }],
        food: { x: 5, y: 5 },
        score: SPEED_STEP_POINTS - FOOD_SCORE,
        speed: DIFFICULTIES.normal.initialSpeed,
        difficulty: "normal",
      })
    );
    expect(next.score).toBe(SPEED_STEP_POINTS);
    expect(next.speed).toBe(
      DIFFICULTIES.normal.initialSpeed + DIFFICULTIES.normal.speedIncrement
    );
  });

  it("hard difficulty speed steps use 1.5 increment", () => {
    const { state: next } = tick(
      state({
        dir: "right",
        body: [{ x: 4, y: 5 }],
        food: { x: 5, y: 5 },
        score: 40,
        speed: 10,
        difficulty: "hard",
      })
    );
    expect(next.speed).toBe(11.5);
  });

  it("filling the whole board is a terminal win with win event", () => {
    const { state: wonState, events } = tick(
      state({
        width: 2,
        height: 2,
        dir: "down",
        body: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        food: { x: 0, y: 1 },
      })
    );
    expect(wonState.won).toBe(true);
    expect(wonState.alive).toBe(true);
    expect(wonState.score).toBe(FOOD_SCORE);
    expect(wonState.body).toHaveLength(4);
    expect(events).toContain("eat");
    expect(events).toContain("win");
    expect(tick(wonState).state).toBe(wonState);
    expect(snakeInput(wonState, "left")).toBe(wonState);
  });

  it("eating bonus emits bonus, grows, despawns (no speed step)", () => {
    const { state: next, events } = tick(
      state({
        dir: "right",
        body: [{ x: 4, y: 5 }],
        food: { x: 9, y: 9 },
        bonus: {
          cell: { x: 5, y: 5 },
          remainingMs: 5_000,
          value: 60,
          size: 20,
        },
        score: 40,
        speed: 7,
        difficulty: "normal",
      })
    );
    expect(next.score).toBe(100);
    expect(next.bonus).toBeNull();
    expect(next.body).toHaveLength(2);
    expect(next.speed).toBe(7);
    expect(events).toEqual(["bonus"]);
  });

  it("overlap: food and bonus on same cell awards both explicitly", () => {
    const { state: next, events } = tick(
      state({
        dir: "right",
        body: [{ x: 4, y: 5 }],
        food: { x: 5, y: 5 },
        bonus: {
          cell: { x: 5, y: 5 },
          remainingMs: 8_000,
          value: 80,
          size: 24,
        },
        score: 0,
      })
    );
    expect(next.score).toBe(FOOD_SCORE + 80);
    expect(next.bonus).toBeNull();
    expect(next.body).toHaveLength(2);
    expect(events).toContain("eat");
    expect(events).toContain("bonus");
  });

  it("respawned food never lands on an active bonus cell", () => {
    // Tiny board so free cells are limited; bonus occupies one free cell.
    // Head eats food at (1,0); body grows; bonus stays at (0,1); only free is (1,1).
    const { state: next } = tick(
      state({
        width: 2,
        height: 2,
        dir: "right",
        body: [{ x: 0, y: 0 }],
        food: { x: 1, y: 0 },
        bonus: {
          cell: { x: 0, y: 1 },
          remainingMs: BONUS_LIFETIME_MS,
          value: BONUS_MAX_VALUE,
          size: BONUS_MAX_SIZE,
        },
        rngSeed: 1,
      })
    );
    expect(next.bonus).not.toBeNull();
    if (!next.bonus) return;
    expect(next.food).not.toEqual(next.bonus.cell);
    expect(next.food).toEqual({ x: 1, y: 1 });
  });
});

describe("bonus food — value/size decay helpers", () => {
  it("value is 100 at full life, 10 at expiry, rounded to tens", () => {
    expect(bonusValueFromRemaining(BONUS_LIFETIME_MS)).toBe(BONUS_MAX_VALUE);
    expect(bonusValueFromRemaining(0)).toBe(BONUS_MIN_VALUE);
    expect(bonusValueFromRemaining(BONUS_LIFETIME_MS / 2)).toBe(60);
    expect(bonusValueFromRemaining(BONUS_LIFETIME_MS * 0.55) % 10).toBe(0);
  });

  it("size decays linearly from max to min", () => {
    expect(bonusSizeFromRemaining(BONUS_LIFETIME_MS)).toBe(BONUS_MAX_SIZE);
    expect(bonusSizeFromRemaining(0)).toBe(BONUS_MIN_SIZE);
    expect(bonusSizeFromRemaining(BONUS_LIFETIME_MS / 2)).toBe(
      (BONUS_MAX_SIZE + BONUS_MIN_SIZE) / 2
    );
  });
});

describe("snakeAdvanceTime — bonus decay / expiry", () => {
  const liveBonus = {
    cell: { x: 2, y: 2 },
    remainingMs: BONUS_LIFETIME_MS,
    value: BONUS_MAX_VALUE,
    size: BONUS_MAX_SIZE,
  };

  it("decays remaining/value/size by dt", () => {
    const { state: next, events } = snakeAdvanceTime(state({ bonus: liveBonus }), 2_500);
    expect(events).toEqual([]);
    expect(next.bonus).not.toBeNull();
    if (!next.bonus) return;
    expect(next.bonus.remainingMs).toBe(7_500);
    expect(next.bonus.value).toBe(bonusValueFromRemaining(7_500));
    expect(next.bonus.size).toBe(bonusSizeFromRemaining(7_500));
  });

  it("expires bonus when remaining hits 0 and emits bonus-expired", () => {
    const { state: next, events } = snakeAdvanceTime(
      state({
        bonus: { ...liveBonus, remainingMs: 100, value: 10, size: 10 },
      }),
      150
    );
    expect(next.bonus).toBeNull();
    expect(events).toEqual(["bonus-expired"]);
  });

  it("is a no-op without an active bonus or when dead/won", () => {
    const plain = state({});
    expect(snakeAdvanceTime(plain, 100).state).toBe(plain);
    const dead = state({ alive: false, bonus: liveBonus });
    expect(snakeAdvanceTime(dead, 100).state).toBe(dead);
  });
});

describe("snakeTick — bonus spawn", () => {
  it("does not spawn before the difficulty frequency counter", () => {
    const { state: s } = tick(
      state({
        bonusTickCounter: DIFFICULTIES.normal.bonusFrequency - 2,
        food: { x: 9, y: 9 },
        body: [{ x: 1, y: 1 }],
        dir: "right",
      })
    );
    expect(s.bonusTickCounter).toBe(DIFFICULTIES.normal.bonusFrequency - 1);
    expect(s.bonus).toBeNull();
  });

  it("eventually spawns a bonus after the frequency window (seeded)", () => {
    let found: SnakeState | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const { state: next } = tick(
        state({
          bonusTickCounter: DIFFICULTIES.normal.bonusFrequency,
          food: { x: 9, y: 9 },
          body: [{ x: 1, y: 1 }],
          dir: "right",
          rngSeed: seed,
        })
      );
      if (next.bonus) found = next;
    }
    expect(found).not.toBeNull();
    if (!found || !found.bonus) return;
    expect(found.bonus.cell).not.toEqual(found.food);
    expect(found.bonus.value).toBe(BONUS_MAX_VALUE);
    expect(found.bonus.remainingMs).toBe(BONUS_LIFETIME_MS);
    expect(found.bonusTickCounter).toBe(0);
  });

  // Locks the ORIGINAL game's cadence (Snake-game/game.js): a failed 15% roll
  // does NOT reset the counter — once past `bonusFrequency` the reducer
  // re-rolls every tick until a spawn succeeds (only success resets to 0).
  it("a failed spawn roll keeps the counter and re-rolls next tick (original cadence)", () => {
    const freq = DIFFICULTIES.normal.bonusFrequency;
    // Find a seed whose roll fails: no bonus, but the rng was consumed.
    let failed: SnakeState | null = null;
    for (let seed = 1; seed < 500 && !failed; seed++) {
      const { state: next } = tick(
        state({
          bonusTickCounter: freq,
          food: { x: 9, y: 9 },
          body: [{ x: 1, y: 1 }],
          dir: "right",
          rngSeed: seed,
        })
      );
      if (next.bonus === null && next.rngSeed !== seed) failed = next;
    }
    expect(failed).not.toBeNull();
    if (!failed) return;
    // The failed roll did NOT reset the window…
    expect(failed.bonusTickCounter).toBe(freq + 1);
    // …so the very next tick rolls again (rng consumed) instead of waiting a
    // full window.
    const { state: after } = tick(failed);
    expect(after.rngSeed).not.toBe(failed.rngSeed);
    expect(after.bonusTickCounter).toBe(after.bonus ? 0 : freq + 2);
  });

  it("spawn is deterministic for a fixed seed + counter", () => {
    const run = (seed: number) =>
      tick(
        state({
          bonusTickCounter: DIFFICULTIES.normal.bonusFrequency,
          food: { x: 9, y: 9 },
          body: [{ x: 1, y: 1 }],
          dir: "right",
          rngSeed: seed,
        })
      );
    expect(run(42)).toEqual(run(42));
  });
});

describe("snakeFrame — interleaved time vs ticks", () => {
  it("a movement tick due before bonus expiry can still collect the bonus", () => {
    // Tick interval at speed 10 = 100ms. Bonus has 30ms left.
    // Frame dt=100 with acc=0: advance 100ms would expire first if batched,
    // but interleaving advances only to the tick (100ms) then ticks —
    // wait: timeToTick=100, step=100, advanceTime expires bonus before tick.
    //
    // Better scenario: acc already 90ms, interval 100ms, bonus remaining 20ms,
    // dt=50 → step to tick = 10ms, advance 10ms (bonus still 10ms), tick, pick up.
    const s = state({
      dir: "right",
      body: [{ x: 4, y: 5 }],
      food: { x: 9, y: 9 },
      bonus: {
        cell: { x: 5, y: 5 },
        remainingMs: 20,
        value: 20,
        size: 12,
      },
      speed: 10, // 100ms/tick
      score: 0,
    });
    const result = snakeFrame(s, 90, 50);
    // After 10ms of time → bonus remaining 10, value still ~10+; then tick eats it.
    expect(result.events).toContain("bonus");
    expect(result.state.bonus).toBeNull();
    expect(result.state.score).toBeGreaterThan(0);
    expect(result.state.alive).toBe(true);
  });

  it("expires bonus before a later tick when remaining elapses mid-frame", () => {
    // acc=0, speed=10 (100ms/tick), bonus remaining 40ms, dt=50.
    // First step advances 50ms → bonus expires; no tick yet (acc=50 < 100).
    const s = state({
      dir: "right",
      body: [{ x: 4, y: 5 }],
      food: { x: 9, y: 9 },
      bonus: {
        cell: { x: 5, y: 5 },
        remainingMs: 40,
        value: 20,
        size: 12,
      },
      speed: 10,
    });
    const result = snakeFrame(s, 0, 50);
    expect(result.events).toContain("bonus-expired");
    expect(result.state.bonus).toBeNull();
    // Head has not moved — no tick fired.
    expect(result.state.body[0]).toEqual({ x: 4, y: 5 });
    expect(result.accMs).toBe(50);
  });

  it("awards bonus value at tick time, not end-of-frame decay", () => {
    // Bonus at full value 100. Tick due immediately (acc ≈ interval).
    // After tick, remaining frame time would decay value if applied first.
    const s = state({
      dir: "right",
      body: [{ x: 4, y: 5 }],
      food: { x: 9, y: 9 },
      bonus: {
        cell: { x: 5, y: 5 },
        remainingMs: BONUS_LIFETIME_MS,
        value: BONUS_MAX_VALUE,
        size: BONUS_MAX_SIZE,
      },
      speed: 10, // 100ms
      score: 0,
    });
    // acc=100 already at interval → first step is 0 time, then tick at full value.
    const result = snakeFrame(s, 100, 200);
    expect(result.events).toContain("bonus");
    expect(result.state.score).toBe(BONUS_MAX_VALUE);
  });

  it("is deterministic for the same state + acc + dt", () => {
    const s = state({
      bonus: {
        cell: { x: 2, y: 2 },
        remainingMs: 5_000,
        value: 50,
        size: 20,
      },
      speed: 7,
    });
    expect(snakeFrame(s, 30, 80)).toEqual(snakeFrame(s, 30, 80));
  });
});

describe("dimension-agnostic board", () => {
  // The renderer picks cols×rows from the stage, so the same rules must hold on
  // any board: the far edge kills exactly at width-1 / height-1.
  const boards: Array<{ w: number; h: number }> = [
    { w: 20, h: 12 },
    { w: 96, h: 51 },
  ];
  for (const { w, h } of boards) {
    it(`the right/bottom edge of a ${w}×${h} board kills`, () => {
      const right = tick(
        state({ width: w, height: h, dir: "right", body: [{ x: w - 1, y: 2 }] })
      );
      expect(right.state.alive).toBe(false);
      expect(right.events).toEqual(["die"]);

      const inside = tick(
        state({ width: w, height: h, dir: "right", body: [{ x: w - 2, y: 2 }] })
      );
      expect(inside.state.alive).toBe(true);

      const bottom = tick(
        state({ width: w, height: h, dir: "down", body: [{ x: 2, y: h - 1 }] })
      );
      expect(bottom.state.alive).toBe(false);
      expect(bottom.events).toEqual(["die"]);
    });

    it(`food always spawns inside a ${w}×${h} board`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const s = initSnake(seed, { width: w, height: h });
        expect(s.food.x).toBeGreaterThanOrEqual(0);
        expect(s.food.y).toBeGreaterThanOrEqual(0);
        expect(s.food.x).toBeLessThan(w);
        expect(s.food.y).toBeLessThan(h);
      }
    });
  }
});

describe("determinism", () => {
  function run(
    seed: number,
    difficulty: Difficulty = "normal",
    width = 12,
    height = 10
  ): SnakeState {
    let s = initSnake(seed, { difficulty, width, height });
    let acc = 0;
    const script: Dir[] = ["down", "right", "up", "left", "down", "right"];
    for (const d of script) {
      s = snakeInput(s, d);
      const a = snakeFrame(s, acc, 200);
      s = a.state;
      acc = a.accMs;
      const b = snakeFrame(s, acc, 200);
      s = b.state;
      acc = b.accMs;
    }
    return s;
  }
  it("same seed + input script ⇒ identical outcome", () => {
    expect(run(777)).toEqual(run(777));
    expect(run(123, "hard")).toEqual(run(123, "hard"));
  });
  it("stays deterministic on other board sizes", () => {
    expect(run(777, "normal", 20, 12)).toEqual(run(777, "normal", 20, 12));
    expect(run(777, "normal", 96, 51)).toEqual(run(777, "normal", 96, 51));
  });
  it("different seeds can diverge (food placement)", () => {
    const a = initSnake(1, { width: 8, height: 8 });
    const b = initSnake(2, { width: 8, height: 8 });
    expect(a.food).not.toEqual(b.food);
  });
});
