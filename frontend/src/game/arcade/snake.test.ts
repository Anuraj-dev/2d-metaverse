import { describe, it, expect } from "vitest";
import {
  initSnake,
  snakeInput,
  snakeTick,
  type Dir,
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
    pendingDir: null,
    food: { x: 9, y: 9 },
    alive: true,
    won: false,
    score: 0,
    rngSeed: 1,
    ...partial,
  };
}

describe("initSnake", () => {
  it("starts alive, length 3, heading right, with food off the body", () => {
    const s = initSnake(1, 12, 10);
    expect(s.alive).toBe(true);
    expect(s.won).toBe(false);
    expect(s.body).toHaveLength(3);
    expect(s.dir).toBe("right");
    expect(s.pendingDir).toBeNull();
    expect(s.score).toBe(0);
    expect(s.body.some((c) => c.x === s.food.x && c.y === s.food.y)).toBe(false);
  });
});

describe("snakeInput — buffering", () => {
  it("buffers the turn without changing the moved direction", () => {
    const s = snakeInput(state({}), "up");
    expect(s.pendingDir).toBe("up");
    expect(s.dir).toBe("right");
  });

  it("keeps only the latest input between ticks (1-deep queue)", () => {
    const s = snakeInput(snakeInput(state({}), "up"), "down");
    expect(s.pendingDir).toBe("down");
  });

  it("ignores input on a dead or won snake", () => {
    const dead = state({ alive: false });
    expect(snakeInput(dead, "up")).toBe(dead);
    const won = state({ won: true });
    expect(snakeInput(won, "up")).toBe(won);
  });
});

describe("snakeTick — turn resolution (validated against last moved dir)", () => {
  it("applies a buffered perpendicular turn", () => {
    const s = snakeTick(snakeInput(state({}), "up"));
    expect(s.body[0]).toEqual({ x: 5, y: 4 });
    expect(s.dir).toBe("up");
    expect(s.pendingDir).toBeNull();
  });

  it("discards a buffered 180° reversal and keeps moving", () => {
    const s = snakeTick(snakeInput(state({ dir: "right" }), "left"));
    expect(s.body[0]).toEqual({ x: 6, y: 5 });
    expect(s.dir).toBe("right");
    expect(s.alive).toBe(true);
  });

  // The round-1 MAJOR: multiple inputs between two ticks must not smuggle in a
  // reversal. Table of multi-input-per-tick sequences from each heading.
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
  const sequences: Array<{ moving: Dir; inputs: Dir[]; expectDir: Dir }> = [
    // up-then-left while moving right: final input reverses → discarded.
    { moving: "right", inputs: ["up", "left"], expectDir: "right" },
    { moving: "right", inputs: ["down", "left"], expectDir: "right" },
    { moving: "left", inputs: ["up", "right"], expectDir: "left" },
    { moving: "up", inputs: ["left", "down"], expectDir: "up" },
    { moving: "down", inputs: ["right", "up"], expectDir: "down" },
    // a legal final input still applies after an earlier (discarded) one.
    { moving: "right", inputs: ["left", "up"], expectDir: "up" },
    { moving: "up", inputs: ["down", "left"], expectDir: "left" },
    // three inputs, last one legal.
    { moving: "right", inputs: ["up", "left", "down"], expectDir: "down" },
  ];
  for (const { moving, inputs, expectDir } of sequences) {
    it(`moving ${moving}, inputs [${inputs.join(", ")}] in one tick ⇒ moves ${expectDir}, stays alive`, () => {
      // Body straight along the moving axis so a folded reversal would collide.
      let s = state({ dir: moving, body: bodies[moving] });
      for (const d of inputs) s = snakeInput(s, d);
      const next = snakeTick(s);
      expect(next.alive).toBe(true);
      expect(next.dir).toBe(expectDir);
    });
  }
});

describe("snakeTick — movement", () => {
  it("slides forward, keeping length (tail removed)", () => {
    const s = snakeTick(state({}));
    expect(s.body[0]).toEqual({ x: 6, y: 5 });
    expect(s.body).toHaveLength(3);
    expect(s.alive).toBe(true);
  });

  it("a dead snake is an idempotent no-op", () => {
    const dead = state({ alive: false });
    expect(snakeTick(dead)).toBe(dead);
  });

  it("a won snake is an idempotent no-op", () => {
    const won = state({ won: true });
    expect(snakeTick(won)).toBe(won);
  });
});

describe("snakeTick — walls", () => {
  const cases: Array<{ dir: Dir; body: SnakeState["body"] }> = [
    { dir: "right", body: [{ x: 9, y: 5 }] },
    { dir: "left", body: [{ x: 0, y: 5 }] },
    { dir: "up", body: [{ x: 5, y: 0 }] },
    { dir: "down", body: [{ x: 5, y: 9 }] },
  ];
  for (const { dir, body } of cases) {
    it(`dies moving ${dir} off the edge`, () => {
      const s = snakeTick(state({ dir, body }));
      expect(s.alive).toBe(false);
    });
  }
});

describe("snakeTick — self collision", () => {
  it("dies when the head runs into the body", () => {
    // Coiled snake; moving right drives the head into a mid-body cell (6,5),
    // which is not the vacating tail (5,6).
    const s = state({
      dir: "right",
      body: [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 5 },
        { x: 6, y: 6 },
        { x: 5, y: 6 },
      ],
    });
    const next = snakeTick(s);
    expect(next.alive).toBe(false);
  });

  it("moving into the vacating tail cell is legal", () => {
    // Head chasing the tail: the tail moves away this tick, so no collision.
    const s = state({
      dir: "up",
      body: [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
        { x: 6, y: 4 },
        { x: 5, y: 4 },
      ],
    });
    const next = snakeTick(snakeInput(s, "up"));
    expect(next.alive).toBe(true);
  });
});

describe("snakeTick — eating", () => {
  it("grows and scores when reaching food, then respawns food", () => {
    const s = state({
      dir: "right",
      body: [{ x: 4, y: 5 }],
      food: { x: 5, y: 5 },
    });
    const next = snakeTick(s);
    expect(next.alive).toBe(true);
    expect(next.won).toBe(false);
    expect(next.score).toBe(1);
    expect(next.body).toHaveLength(2);
    expect(next.body[0]).toEqual({ x: 5, y: 5 });
    // New food is not on the eaten cell.
    expect(next.food).not.toEqual({ x: 5, y: 5 });
  });

  it("filling the whole board is a terminal win", () => {
    // 2x2 board: snake occupies 3 cells, food on the last one. Eating it
    // fills the board → won; further ticks and inputs are no-ops.
    const s = state({
      width: 2,
      height: 2,
      dir: "down",
      body: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      food: { x: 0, y: 1 },
    });
    // Head (0,0) moving down reaches (0,1) = food → board full.
    const wonState = snakeTick(s);
    expect(wonState.won).toBe(true);
    expect(wonState.alive).toBe(true);
    expect(wonState.score).toBe(1);
    expect(wonState.body).toHaveLength(4);
    expect(snakeTick(wonState)).toBe(wonState);
    expect(snakeInput(wonState, "left")).toBe(wonState);
  });
});

describe("determinism", () => {
  function run(seed: number): SnakeState {
    let s = initSnake(seed, 12, 10);
    const script: Dir[] = ["down", "right", "up", "left", "down", "right"];
    for (const d of script) {
      s = snakeInput(s, d);
      s = snakeTick(s);
      s = snakeTick(s);
    }
    return s;
  }
  it("same seed + input script ⇒ identical outcome", () => {
    expect(run(777)).toEqual(run(777));
  });
  it("different seeds can diverge (food placement)", () => {
    const a = initSnake(1, 8, 8);
    const b = initSnake(2, 8, 8);
    expect(a.food).not.toEqual(b.food);
  });
});
