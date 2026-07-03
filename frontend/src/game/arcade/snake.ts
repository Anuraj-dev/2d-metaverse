/**
 * Snake — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. All randomness
 * (food placement) flows through the seeded PRNG carried in `rngSeed`, so a
 * given seed + input script always produces the same run (see snake.test.ts).
 *
 * Coordinate system: integer grid cells, origin top-left, `x` right, `y` down.
 * The scene renders `body`/`food`; it never re-derives a rule here.
 */
import { nextInt } from "./prng";

export type Dir = "up" | "down" | "left" | "right";

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface SnakeState {
  readonly width: number;
  readonly height: number;
  /** Head first, tail last. */
  readonly body: readonly Cell[];
  /** Direction the next tick will move in. */
  readonly dir: Dir;
  readonly food: Cell;
  readonly alive: boolean;
  readonly score: number;
  readonly rngSeed: number;
}

export const DEFAULT_SNAKE_WIDTH = 17;
export const DEFAULT_SNAKE_HEIGHT = 15;

const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

function eq(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Place food on a random empty cell. If the board is full (win), keep the old
 * food position — the caller treats a full board as a completed game.
 */
function placeFood(
  width: number,
  height: number,
  occupied: readonly Cell[],
  seed: number
): { food: Cell; rngSeed: number } {
  const free: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = { x, y };
      if (!occupied.some((c) => eq(c, cell))) free.push(cell);
    }
  }
  if (free.length === 0) {
    const head = occupied[0] ?? { x: 0, y: 0 };
    return { food: head, rngSeed: seed };
  }
  const { value, seed: rngSeed } = nextInt(seed, free.length);
  const food = free[value] ?? free[0];
  // free is non-empty here, so free[0] always exists.
  return { food: food ?? { x: 0, y: 0 }, rngSeed };
}

/** Fresh game: a length-3 snake centred and heading right, with food placed. */
export function initSnake(
  seed: number,
  width = DEFAULT_SNAKE_WIDTH,
  height = DEFAULT_SNAKE_HEIGHT
): SnakeState {
  const cy = Math.floor(height / 2);
  const cx = Math.floor(width / 2);
  const body: Cell[] = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
  const { food, rngSeed } = placeFood(width, height, body, seed);
  return {
    width,
    height,
    body,
    dir: "right",
    food,
    alive: true,
    score: 0,
    rngSeed,
  };
}

/**
 * Queue a turn. A 180° reversal is rejected (you cannot fold back onto your
 * neck); every other direction is accepted for the next tick.
 */
export function snakeInput(state: SnakeState, dir: Dir): SnakeState {
  if (!state.alive) return state;
  if (dir === OPPOSITE[state.dir]) return state;
  return { ...state, dir };
}

/**
 * Advance one step:
 *  - moving out of bounds or into your own body (except the tail cell you are
 *    about to vacate) kills the snake — state returned with `alive: false`.
 *  - eating food grows the snake (tail retained) and spawns new food.
 *  - otherwise the snake slides (tail removed).
 * A dead snake is an idempotent no-op.
 */
export function snakeTick(state: SnakeState): SnakeState {
  if (!state.alive) return state;
  const head = state.body[0];
  if (!head) return state;

  const delta = DELTA[state.dir];
  const next: Cell = { x: head.x + delta.x, y: head.y + delta.y };

  if (
    next.x < 0 ||
    next.y < 0 ||
    next.x >= state.width ||
    next.y >= state.height
  ) {
    return { ...state, alive: false };
  }

  const eating = eq(next, state.food);
  // When not eating, the tail moves away this tick, so colliding with the
  // current tail cell is legal.
  const bodyToCheck = eating ? state.body : state.body.slice(0, -1);
  if (bodyToCheck.some((c) => eq(c, next))) {
    return { ...state, alive: false };
  }

  if (eating) {
    const grown = [next, ...state.body];
    const { food, rngSeed } = placeFood(
      state.width,
      state.height,
      grown,
      state.rngSeed
    );
    return {
      ...state,
      body: grown,
      food,
      score: state.score + 1,
      rngSeed,
    };
  }

  const moved = [next, ...state.body.slice(0, -1)];
  return { ...state, body: moved };
}
