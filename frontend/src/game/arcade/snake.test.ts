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
    food: { x: 9, y: 9 },
    alive: true,
    score: 0,
    rngSeed: 1,
    ...partial,
  };
}

describe("initSnake", () => {
  it("starts alive, length 3, heading right, with food off the body", () => {
    const s = initSnake(1, 12, 10);
    expect(s.alive).toBe(true);
    expect(s.body).toHaveLength(3);
    expect(s.dir).toBe("right");
    expect(s.score).toBe(0);
    expect(s.body.some((c) => c.x === s.food.x && c.y === s.food.y)).toBe(false);
  });
});

describe("snakeInput", () => {
  it("accepts a perpendicular turn", () => {
    expect(snakeInput(state({}), "up").dir).toBe("up");
  });

  it("rejects a 180° reversal", () => {
    expect(snakeInput(state({ dir: "right" }), "left").dir).toBe("right");
    expect(snakeInput(state({ dir: "up" }), "down").dir).toBe("up");
  });

  it("ignores input on a dead snake", () => {
    const dead = state({ alive: false, dir: "right" });
    expect(snakeInput(dead, "up")).toBe(dead);
  });
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
    // Turn left so head goes to (4,5) — clearly free — sanity of the setup.
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
    expect(next.score).toBe(1);
    expect(next.body).toHaveLength(2);
    expect(next.body[0]).toEqual({ x: 5, y: 5 });
    // New food is not on the eaten cell.
    expect(next.food).not.toEqual({ x: 5, y: 5 });
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
    // Two long runs eating food will diverge once RNG-placed food differs.
    const a = initSnake(1, 8, 8);
    const b = initSnake(2, 8, 8);
    expect(a.food).not.toEqual(b.food);
  });
});
