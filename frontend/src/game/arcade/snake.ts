/**
 * Snake — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. All randomness
 * (food placement) flows through the seeded PRNG carried in `rngSeed`, so a
 * given seed + input script always produces the same run (see snake.test.ts).
 *
 * Coordinate system: integer grid cells, origin top-left, `x` right, `y` down.
 * The scene renders `body`/`food`/`walls`; it never re-derives a rule here.
 *
 * LEVELS ARE DATA (issue #163). A level is an ASCII map parsed once at module
 * load into `{ width, height, walls, start }` and handed to `initSnake`. Adding
 * a level is adding rows to `SNAKE_LEVELS` — the reducer below is level-agnostic
 * and treats every wall cell as lethal, exactly like the board edge.
 *
 * SPEED IS DATA TOO: `SNAKE_SPEEDS` holds the tick cadence per tier. The tick
 * interval is a presentation cadence, not a rule (the reducer is per-step), so
 * the renderer reads it from here rather than hard-coding a magic number.
 */
import { nextInt } from "./prng";

export type Dir = "up" | "down" | "left" | "right";

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export type SnakeLevelId = "open" | "pillars" | "corridors" | "vault";

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
  /** Lethal obstacle cells from the level layout (empty on the "open" level). */
  readonly walls: readonly Cell[];
  /** Which level this run is playing (carried so the HUD can label it). */
  readonly levelId: SnakeLevelId;
  readonly alive: boolean;
  /** Terminal win: the snake fills every non-wall cell of the board. */
  readonly won: boolean;
  readonly score: number;
  readonly rngSeed: number;
}

export interface SnakeLevel {
  readonly id: SnakeLevelId;
  readonly name: string;
  /** One-line description shown next to the level picker. */
  readonly hint: string;
  readonly width: number;
  readonly height: number;
  readonly walls: readonly Cell[];
  /** Head cell of the starting snake; the two body cells extend to its left. */
  readonly start: Cell;
}

export type SnakeSpeedId = "chill" | "normal" | "fast";

export interface SnakeSpeed {
  readonly id: SnakeSpeedId;
  readonly label: string;
  /** Milliseconds between reducer ticks. */
  readonly tickMs: number;
}

/**
 * The three speed tiers. `normal` keeps the historical 110ms cadence so old
 * high scores stay comparable; `chill` is a genuinely relaxed 180ms (the fix
 * for "too fast to be playable") and `fast` is the challenge tier.
 */
export const SNAKE_SPEEDS: readonly SnakeSpeed[] = [
  { id: "chill", label: "Chill", tickMs: 180 },
  { id: "normal", label: "Normal", tickMs: 110 },
  { id: "fast", label: "Fast", tickMs: 75 },
];

const DEFAULT_SNAKE_SPEED: SnakeSpeed = { id: "normal", label: "Normal", tickMs: 110 };

/** Resolve a (possibly stale/persisted) speed id; unknown ids fall back to Normal. */
export function snakeSpeedById(id: string): SnakeSpeed {
  return SNAKE_SPEEDS.find((s) => s.id === id) ?? DEFAULT_SNAKE_SPEED;
}

/**
 * Parse an ASCII level map. `#` is a wall, `>` marks the head start cell (the
 * snake starts heading right with two body cells to its left), everything else
 * is empty floor. Rows must all be the same length and contain exactly one `>`
 * with two free cells to its left — asserted by the level tests.
 */
export function parseSnakeLevel(
  id: SnakeLevelId,
  name: string,
  hint: string,
  rows: readonly string[]
): SnakeLevel {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const walls: Cell[] = [];
  let start: Cell = { x: 2, y: 0 };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "#") walls.push({ x, y });
      else if (ch === ">") start = { x, y };
    }
  });
  return { id, name, hint, width, height, walls, start };
}

// Every level is 17 × 15, so the canvas geometry (and therefore the arcade
// stage layout) is identical whichever level is picked.
const OPEN_LEVEL = parseSnakeLevel("open", "Open Field", "No obstacles — pure snake.", [
  ".................",
  ".................",
  ".................",
  ".................",
  ".................",
  ".................",
  ".................",
  "........>........",
  ".................",
  ".................",
  ".................",
  ".................",
  ".................",
  ".................",
  ".................",
]);

const PILLARS_LEVEL = parseSnakeLevel("pillars", "Pillars", "Six blocks to weave around.", [
  ".................",
  ".................",
  ".................",
  "...##...##...##..",
  "...##...##...##..",
  ".................",
  ".................",
  "........>........",
  ".................",
  ".................",
  "...##...##...##..",
  "...##...##...##..",
  ".................",
  ".................",
  ".................",
]);

const CORRIDORS_LEVEL = parseSnakeLevel(
  "corridors",
  "Corridors",
  "Thread the gaps between the walls.",
  [
    "....#.......#....",
    "....#.......#....",
    "....#.......#....",
    "....#.......#....",
    "....#.......#....",
    "....#...#...#....",
    "....#...#...#....",
    "....#...#...#....",
    "....#...#...#....",
    "....#...#...#....",
    "........#........",
    "........#........",
    ".................",
    "........>........",
    ".................",
  ]
);

const VAULT_LEVEL = parseSnakeLevel("vault", "The Vault", "Start boxed in — four doors out.", [
  ".................",
  ".................",
  ".................",
  "...#####.#####...",
  "...#.........#...",
  "...#.........#...",
  "...#.........#...",
  "........>........",
  "...#.........#...",
  "...#.........#...",
  "...#.........#...",
  "...#####.#####...",
  ".................",
  ".................",
  ".................",
]);

/** The designed levels, in pick order. The first is the default. */
export const SNAKE_LEVELS: readonly SnakeLevel[] = [
  OPEN_LEVEL,
  PILLARS_LEVEL,
  CORRIDORS_LEVEL,
  VAULT_LEVEL,
];

export const DEFAULT_SNAKE_LEVEL = OPEN_LEVEL;

/** Resolve a (possibly stale/persisted) level id; unknown ids fall back to Open Field. */
export function snakeLevelById(id: string): SnakeLevel {
  return SNAKE_LEVELS.find((l) => l.id === id) ?? DEFAULT_SNAKE_LEVEL;
}

export const DEFAULT_SNAKE_WIDTH = DEFAULT_SNAKE_LEVEL.width;
export const DEFAULT_SNAKE_HEIGHT = DEFAULT_SNAKE_LEVEL.height;

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

function has(cells: readonly Cell[], cell: Cell): boolean {
  return cells.some((c) => eq(c, cell));
}

/**
 * Place food on a random empty (non-body, non-wall) cell. If nothing is free
 * (win), keep the old food position — the caller marks the game `won` and stops
 * play.
 */
function placeFood(
  width: number,
  height: number,
  occupied: readonly Cell[],
  walls: readonly Cell[],
  seed: number
): { food: Cell; rngSeed: number } {
  const free: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = { x, y };
      if (!has(occupied, cell) && !has(walls, cell)) free.push(cell);
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

/**
 * Fresh game on `level`: a length-3 snake at the level's start cell heading
 * right, with food placed on a free cell.
 */
export function initSnake(seed: number, level: SnakeLevel = DEFAULT_SNAKE_LEVEL): SnakeState {
  const { x, y } = level.start;
  const body: Cell[] = [
    { x, y },
    { x: x - 1, y },
    { x: x - 2, y },
  ];
  const { food, rngSeed } = placeFood(level.width, level.height, body, level.walls, seed);
  return {
    width: level.width,
    height: level.height,
    body,
    dir: "right",
    pendingDir: null,
    food,
    walls: level.walls,
    levelId: level.id,
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
 *  - moving out of bounds, into a level wall, or into your own body (except the
 *    tail cell you are about to vacate) kills the snake — `alive: false`;
 *  - eating food grows the snake (tail retained) and spawns new food;
 *  - filling every non-wall cell is a terminal win (`won: true`);
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

  // Level walls are as lethal as the board edge.
  if (has(state.walls, next)) {
    return { ...state, dir, pendingDir: null, alive: false };
  }

  const eating = eq(next, state.food);
  // When not eating, the tail moves away this tick, so colliding with the
  // current tail cell is legal.
  const bodyToCheck = eating ? state.body : state.body.slice(0, -1);
  if (has(bodyToCheck, next)) {
    return { ...state, dir, pendingDir: null, alive: false };
  }

  if (eating) {
    const grown = [next, ...state.body];
    const won = grown.length >= state.width * state.height - state.walls.length;
    const { food, rngSeed } = placeFood(
      state.width,
      state.height,
      grown,
      state.walls,
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

/** True when `cell` is outside the board or on a level wall. Rendering/near-miss helper. */
export function isBlockedCell(state: SnakeState, cell: Cell): boolean {
  if (cell.x < 0 || cell.y < 0 || cell.x >= state.width || cell.y >= state.height) return true;
  return has(state.walls, cell);
}
