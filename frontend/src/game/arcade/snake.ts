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
  /** Direction the snake actually last moved in. */
  readonly dir: Dir;
  /**
   * Buffered turn (1-deep queue): the latest input since the last tick,
   * validated at TICK time against `dir` — the direction actually last moved.
   * Validating on input alone is bypassable: moving right, pressing up then
   * left within one tick would legalize the reversal step-by-step and fold the
   * head into the neck. Deferring the check makes multi-input-per-tick safe.
   */
  readonly pendingDir: Dir | null;
  readonly food: Cell;
  readonly alive: boolean;
  /** Terminal win: the snake fills the entire board. */
  readonly won: boolean;
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
 * food position — the caller marks the game `won` and stops play.
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
    pendingDir: null,
    food,
    alive: true,
    won: false,
    score: 0,
    rngSeed,
  };
}

/**
 * Buffer a turn for the next tick (1-deep queue — the latest input between two
 * ticks wins). Legality is NOT decided here: the tick validates the buffered
 * direction against the direction actually last moved, so no input sequence
 * can smuggle in a 180° reversal. Terminal states ignore input.
 */
export function snakeInput(state: SnakeState, dir: Dir): SnakeState {
  if (!state.alive || state.won) return state;
  return { ...state, pendingDir: dir };
}

/**
 * Advance one step:
 *  - the buffered turn applies only if it is not a 180° reversal of the
 *    direction actually last moved (else it is discarded);
 *  - moving out of bounds or into your own body (except the tail cell you are
 *    about to vacate) kills the snake — state returned with `alive: false`;
 *  - eating food grows the snake (tail retained) and spawns new food;
 *  - filling the whole board is a terminal win (`won: true`);
 *  - otherwise the snake slides (tail removed).
 * Dead or won states are idempotent no-ops.
 */
export function snakeTick(state: SnakeState): SnakeState {
  if (!state.alive || state.won) return state;
  const head = state.body[0];
  if (!head) return state;

  // Resolve the buffered turn against the last actually-moved direction.
  const dir =
    state.pendingDir !== null && state.pendingDir !== OPPOSITE[state.dir]
      ? state.pendingDir
      : state.dir;

  const delta = DELTA[dir];
  const next: Cell = { x: head.x + delta.x, y: head.y + delta.y };

  if (
    next.x < 0 ||
    next.y < 0 ||
    next.x >= state.width ||
    next.y >= state.height
  ) {
    return { ...state, dir, pendingDir: null, alive: false };
  }

  const eating = eq(next, state.food);
  // When not eating, the tail moves away this tick, so colliding with the
  // current tail cell is legal.
  const bodyToCheck = eating ? state.body : state.body.slice(0, -1);
  if (bodyToCheck.some((c) => eq(c, next))) {
    return { ...state, dir, pendingDir: null, alive: false };
  }

  if (eating) {
    const grown = [next, ...state.body];
    const won = grown.length >= state.width * state.height;
    const { food, rngSeed } = placeFood(
      state.width,
      state.height,
      grown,
      state.rngSeed
    );
    return {
      ...state,
      dir,
      pendingDir: null,
      body: grown,
      food,
      won,
      score: state.score + 1,
      rngSeed,
    };
  }

  const moved = [next, ...state.body.slice(0, -1)];
  return { ...state, dir, pendingDir: null, body: moved };
}
