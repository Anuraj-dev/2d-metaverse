import { describe, it, expect } from "vitest";
import {
  DEFAULT_SNAKE_LEVEL,
  SNAKE_LEVELS,
  SNAKE_SPEEDS,
  initSnake,
  isBlockedCell,
  parseSnakeLevel,
  snakeInput,
  snakeLevelById,
  snakeSpeedById,
  snakeTick,
  type Dir,
  type SnakeLevel,
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
    walls: [],
    levelId: "open",
    alive: true,
    won: false,
    score: 0,
    rngSeed: 1,
    ...partial,
  };
}

/** A bare level for tests that only care about dimensions. */
function level(width: number, height: number, walls: SnakeLevel["walls"] = []): SnakeLevel {
  return {
    id: "open",
    name: "test",
    hint: "test",
    width,
    height,
    walls,
    start: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
  };
}

describe("initSnake", () => {
  it("starts alive, length 3, heading right, with food off the body", () => {
    const s = initSnake(1, level(12, 10));
    expect(s.alive).toBe(true);
    expect(s.won).toBe(false);
    expect(s.body).toHaveLength(3);
    expect(s.dir).toBe("right");
    expect(s.pendingDir).toBeNull();
    expect(s.score).toBe(0);
    expect(s.body.some((c) => c.x === s.food.x && c.y === s.food.y)).toBe(false);
  });

  it("defaults to the Open Field level", () => {
    const s = initSnake(1);
    expect(s.levelId).toBe(DEFAULT_SNAKE_LEVEL.id);
    expect(s.walls).toHaveLength(0);
    expect(s.width).toBe(DEFAULT_SNAKE_LEVEL.width);
    expect(s.height).toBe(DEFAULT_SNAKE_LEVEL.height);
  });

  it("never places food on a wall cell", () => {
    // Every seed must land on floor, so sweep a range rather than one draw.
    const vault = snakeLevelById("vault");
    for (let seed = 1; seed <= 60; seed++) {
      const s = initSnake(seed, vault);
      expect(s.walls.some((w) => w.x === s.food.x && w.y === s.food.y)).toBe(false);
    }
  });
});

describe("snake levels (data)", () => {
  it("ships at least three distinct designed levels", () => {
    expect(SNAKE_LEVELS.length).toBeGreaterThanOrEqual(3);
    const ids = SNAKE_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    // "distinct obstacle layouts" — every level past the first has walls, and
    // no two levels share the same wall set.
    const layouts = SNAKE_LEVELS.map((l) =>
      JSON.stringify([...l.walls].map((w) => `${w.x},${w.y}`).sort())
    );
    expect(new Set(layouts).size).toBe(layouts.length);
    expect(SNAKE_LEVELS.filter((l) => l.walls.length > 0).length).toBeGreaterThanOrEqual(3);
  });

  for (const l of SNAKE_LEVELS) {
    describe(`level "${l.id}"`, () => {
      it("is a rectangle with in-bounds walls", () => {
        expect(l.width).toBeGreaterThan(0);
        expect(l.height).toBeGreaterThan(0);
        for (const w of l.walls) {
          expect(w.x).toBeGreaterThanOrEqual(0);
          expect(w.y).toBeGreaterThanOrEqual(0);
          expect(w.x).toBeLessThan(l.width);
          expect(w.y).toBeLessThan(l.height);
        }
      });

      it("has a start with three free cells and room to move", () => {
        const cells = [
          l.start,
          { x: l.start.x - 1, y: l.start.y },
          { x: l.start.x - 2, y: l.start.y },
        ];
        for (const c of cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(l.walls.some((w) => w.x === c.x && w.y === c.y)).toBe(false);
        }
        // The very first tick must not be an instant death.
        const s = snakeTick(initSnake(9, l));
        expect(s.alive).toBe(true);
      });

      it("kills the snake on every one of its wall cells", () => {
        for (const w of l.walls) {
          // Approach the wall from the left when possible, else from above.
          const fromLeft = w.x > 0;
          const head = fromLeft ? { x: w.x - 1, y: w.y } : { x: w.x, y: w.y - 1 };
          const dir: Dir = fromLeft ? "right" : "down";
          const s = state({
            width: l.width,
            height: l.height,
            walls: l.walls,
            levelId: l.id,
            dir,
            body: [head],
            // Keep food far away so this is a pure collision test.
            food: { x: -1, y: -1 },
          });
          expect(snakeTick(s).alive).toBe(false);
        }
      });
    });
  }

  it("parses ASCII maps into walls + start", () => {
    const l = parseSnakeLevel("pillars", "T", "t", ["..#..", "..>..", "#...#"]);
    expect(l.width).toBe(5);
    expect(l.height).toBe(3);
    expect(l.start).toEqual({ x: 2, y: 1 });
    expect(l.walls).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 4, y: 2 },
    ]);
  });

  // parseSnakeLevel validates its documented invariants instead of assuming
  // them; the shipped levels parse at module load, so a malformed layout edit
  // fails the suite immediately.
  describe("parseSnakeLevel — malformed layouts throw", () => {
    it("rejects an empty layout and an empty first row", () => {
      expect(() => parseSnakeLevel("open", "T", "t", [])).toThrow(/non-empty row/);
      expect(() => parseSnakeLevel("open", "T", "t", ["", ""])).toThrow(/non-empty row/);
    });

    it("rejects ragged (non-rectangular) rows", () => {
      expect(() => parseSnakeLevel("open", "T", "t", ["..>..", "...."])).toThrow(/rectangular/);
      expect(() => parseSnakeLevel("open", "T", "t", ["..>..", "......"])).toThrow(/rectangular/);
    });

    it("rejects a layout without a start marker", () => {
      expect(() => parseSnakeLevel("open", "T", "t", [".....", "....."])).toThrow(
        /missing the ">"/
      );
    });

    it("rejects more than one start marker", () => {
      expect(() => parseSnakeLevel("open", "T", "t", ["..>.>", "....."])).toThrow(
        /more than one/
      );
    });

    it("rejects a start with fewer than two cells to its left", () => {
      expect(() => parseSnakeLevel("open", "T", "t", [">....", "....."])).toThrow(
        /two cells to its left/
      );
      expect(() => parseSnakeLevel("open", "T", "t", [".>...", "....."])).toThrow(
        /two cells to its left/
      );
    });

    it("rejects walls where the starting body spawns", () => {
      expect(() => parseSnakeLevel("open", "T", "t", ["#.>..", "....."])).toThrow(/floor/);
      expect(() => parseSnakeLevel("open", "T", "t", [".#>..", "....."])).toThrow(/floor/);
    });

    it("accepts walls elsewhere on the start row", () => {
      const l = parseSnakeLevel("open", "T", "t", ["..>.#", "....."]);
      expect(l.start).toEqual({ x: 2, y: 0 });
      expect(l.walls).toEqual([{ x: 4, y: 0 }]);
    });
  });

  it("resolves level ids, falling back to Open Field for unknown ones", () => {
    expect(snakeLevelById("vault").id).toBe("vault");
    expect(snakeLevelById("nope").id).toBe(DEFAULT_SNAKE_LEVEL.id);
  });
});

describe("snake speeds (data)", () => {
  it("offers three tiers, slowest first", () => {
    expect(SNAKE_SPEEDS.map((s) => s.id)).toEqual(["chill", "normal", "fast"]);
    const ms = SNAKE_SPEEDS.map((s) => s.tickMs);
    expect(ms[0]).toBeGreaterThan(ms[1] ?? 0);
    expect(ms[1]).toBeGreaterThan(ms[2] ?? 0);
  });

  it("resolves speed ids, falling back to Normal for unknown ones", () => {
    expect(snakeSpeedById("chill").tickMs).toBe(180);
    expect(snakeSpeedById("nope").id).toBe("normal");
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

describe("snakeTick — board edges", () => {
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

describe("snakeTick — level walls", () => {
  const walls = [{ x: 6, y: 5 }];
  const cases: Array<{ dir: Dir; body: SnakeState["body"]; dies: boolean }> = [
    { dir: "right", body: [{ x: 5, y: 5 }], dies: true },
    { dir: "left", body: [{ x: 7, y: 5 }], dies: true },
    { dir: "up", body: [{ x: 6, y: 6 }], dies: true },
    { dir: "down", body: [{ x: 6, y: 4 }], dies: true },
    // Sliding past the wall on the adjacent lane is safe.
    { dir: "right", body: [{ x: 5, y: 4 }], dies: false },
  ];
  for (const { dir, body, dies } of cases) {
    it(`moving ${dir} from (${body[0]?.x},${body[0]?.y}) ${dies ? "dies" : "survives"}`, () => {
      const s = snakeTick(state({ dir, body, walls }));
      expect(s.alive).toBe(!dies);
    });
  }

  it("a wall kill does not grow, score, or move the snake into the wall", () => {
    const before = state({ dir: "right", body: [{ x: 5, y: 5 }], walls });
    const after = snakeTick(before);
    expect(after.alive).toBe(false);
    expect(after.score).toBe(0);
    expect(after.body).toEqual(before.body);
  });

  it("food is never respawned onto a wall after eating", () => {
    // 3x3 board walled everywhere except a 1x3 lane, so a bad implementation
    // would be forced onto a wall cell.
    const laneWalls = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ];
    const s = state({
      width: 3,
      height: 3,
      walls: laneWalls,
      dir: "right",
      body: [{ x: 0, y: 1 }],
      food: { x: 1, y: 1 },
    });
    const next = snakeTick(s);
    expect(next.score).toBe(1);
    expect(laneWalls.some((w) => w.x === next.food.x && w.y === next.food.y)).toBe(false);
  });
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

  it("walls shrink the board a win has to fill", () => {
    // 2x3 board with the bottom row walled → only the top 2x1... use 3x2 with
    // the right column walled: the winnable area is the 2x2 left block.
    const walls = [
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ];
    const s = state({
      width: 3,
      height: 2,
      walls,
      dir: "down",
      body: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      food: { x: 0, y: 1 },
    });
    const wonState = snakeTick(s);
    expect(wonState.won).toBe(true);
  });
});

describe("isBlockedCell", () => {
  it("reports edges and walls, not open floor", () => {
    const s = state({ walls: [{ x: 3, y: 3 }] });
    expect(isBlockedCell(s, { x: -1, y: 0 })).toBe(true);
    expect(isBlockedCell(s, { x: 10, y: 0 })).toBe(true);
    expect(isBlockedCell(s, { x: 0, y: 10 })).toBe(true);
    expect(isBlockedCell(s, { x: 3, y: 3 })).toBe(true);
    expect(isBlockedCell(s, { x: 4, y: 3 })).toBe(false);
  });
});

describe("determinism", () => {
  function run(seed: number, l = level(12, 10)): SnakeState {
    let s = initSnake(seed, l);
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

  it("holds on every shipped level", () => {
    for (const l of SNAKE_LEVELS) {
      expect(run(4242, l)).toEqual(run(4242, l));
    }
  });

  it("different seeds can diverge (food placement)", () => {
    const a = initSnake(1, level(8, 8));
    const b = initSnake(2, level(8, 8));
    expect(a.food).not.toEqual(b.food);
  });
});
