/**
 * Snake — pure game rules (ported from the owner's standalone Snake game).
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. All randomness
 * (food / bonus placement, bonus spawn rolls) flows through the seeded PRNG
 * carried in `rngSeed`, so a given seed + input script always produces the same
 * run (see snake.test.ts).
 *
 * Coordinate system: integer grid cells, origin top-left, `x` right, `y` down.
 * The board is a single `width`×`height` rect and its edges kill — classic
 * snake. The module is dimension-agnostic: the renderer measures the stage and
 * passes whatever cols×rows fits at its fixed cell size.
 *
 * The renderer draws `body`/`food`/`bonus` and forwards `events` to the bus;
 * it never re-derives a rule here.
 */
import { nextFloat, nextInt } from "./prng";

export type Dir = "up" | "down" | "left" | "right";

export type Difficulty = "easy" | "normal" | "hard";

/**
 * Domain events produced by the pure layer. The renderer maps these onto the
 * typed event bus (sound mixer) — it does not re-derive eat/bonus/die from
 * state diffs.
 */
export type SnakeEvent =
  | "eat"
  | "bonus"
  | "milestone"
  | "die"
  | "win"
  | "bonus-expired";

export interface SnakeStep {
  readonly state: SnakeState;
  readonly events: readonly SnakeEvent[];
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Live bonus food: position + wall-clock lifetime (ms remaining). */
export interface BonusFood {
  readonly cell: Cell;
  /** Milliseconds of life remaining (starts at BONUS_LIFETIME_MS). */
  readonly remainingMs: number;
  /** Current point value (decays 100 → 10, rounded to tens). */
  readonly value: number;
  /** Render size (px at design cell scale); decays with remainingMs. */
  readonly size: number;
}

export interface DifficultyConfig {
  readonly initialSpeed: number;
  readonly speedIncrement: number;
  readonly bonusFrequency: number;
}

/** Original game tuning: ticks-per-second, speed step, bonus spawn period. */
export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyConfig>> = {
  easy: { initialSpeed: 5, speedIncrement: 0.5, bonusFrequency: 150 },
  normal: { initialSpeed: 7, speedIncrement: 1, bonusFrequency: 180 },
  hard: { initialSpeed: 10, speedIncrement: 1.5, bonusFrequency: 220 },
};

export const SPEED_CAP = 15;
export const FOOD_SCORE = 10;
export const SPEED_STEP_POINTS = 50;
export const BONUS_LIFETIME_MS = 10_000;
export const BONUS_MAX_VALUE = 100;
export const BONUS_MIN_VALUE = 10;
export const BONUS_MAX_SIZE = 30;
export const BONUS_MIN_SIZE = 10;
export const BONUS_SPAWN_CHANCE = 0.15;
/** Max buffered turns (original game). */
export const DIR_QUEUE_MAX = 3;

/**
 * Fallback board when the host has not measured a stage yet (headless/jsdom).
 * Roughly the original's 37×20 proportions; a real run always overrides it with
 * whatever whole cells the stage can show.
 */
export const DEFAULT_SNAKE_WIDTH = 34;
export const DEFAULT_SNAKE_HEIGHT = 18;

export interface SnakeState {
  /** Board size in cells; the edges kill. */
  readonly width: number;
  readonly height: number;
  /** Head first, tail last. */
  readonly body: readonly Cell[];
  /** Direction the snake actually last moved in. */
  readonly dir: Dir;
  /**
   * Buffered turns (up to DIR_QUEUE_MAX deep). One entry is consumed per tick
   * and validated against `dir` — the direction actually last moved — so no
   * input sequence can smuggle a 180° reversal within a single step.
   */
  readonly dirQueue: readonly Dir[];
  readonly food: Cell;
  readonly bonus: BonusFood | null;
  /** Ticks counted toward the next bonus spawn window. */
  readonly bonusTickCounter: number;
  readonly alive: boolean;
  /** Terminal win: the snake fills the entire board. */
  readonly won: boolean;
  readonly score: number;
  /** Current ticks-per-second (renderer drives its interval from this). */
  readonly speed: number;
  readonly difficulty: Difficulty;
  readonly rngSeed: number;
}

export interface InitSnakeOptions {
  readonly difficulty?: Difficulty;
  readonly width?: number;
  readonly height?: number;
}

/** Result of one animation-frame of pure scheduling (time ↔ ticks interleaved). */
export interface SnakeFrameResult {
  readonly state: SnakeState;
  /** Accumulator: ms since the last movement tick (0..tickInterval). */
  readonly accMs: number;
  readonly events: readonly SnakeEvent[];
}

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

function tickIntervalMs(speed: number): number {
  return 1000 / Math.max(0.5, speed);
}

/** Speed from score + difficulty (capped). Pure so tests can assert steps. */
export function speedForScore(score: number, difficulty: Difficulty): number {
  const cfg = DIFFICULTIES[difficulty];
  const steps = Math.floor(Math.max(0, score) / SPEED_STEP_POINTS);
  return Math.min(SPEED_CAP, cfg.initialSpeed + steps * cfg.speedIncrement);
}

/**
 * Bonus value from remaining lifetime: linear 100 → 10, rounded to tens.
 */
export function bonusValueFromRemaining(remainingMs: number): number {
  const ratio = Math.max(0, Math.min(1, remainingMs / BONUS_LIFETIME_MS));
  const raw =
    BONUS_MIN_VALUE + (BONUS_MAX_VALUE - BONUS_MIN_VALUE) * ratio;
  const rounded = Math.round(raw / 10) * 10;
  return Math.max(BONUS_MIN_VALUE, Math.min(BONUS_MAX_VALUE, rounded));
}

/** Bonus drawn size from remaining lifetime: linear max → min. */
export function bonusSizeFromRemaining(remainingMs: number): number {
  const ratio = Math.max(0, Math.min(1, remainingMs / BONUS_LIFETIME_MS));
  return BONUS_MIN_SIZE + (BONUS_MAX_SIZE - BONUS_MIN_SIZE) * ratio;
}

function refreshBonus(cell: Cell, remainingMs: number): BonusFood {
  return {
    cell,
    remainingMs,
    value: bonusValueFromRemaining(remainingMs),
    size: bonusSizeFromRemaining(remainingMs),
  };
}

/** Free cells of the board in row-major order (the seeded pick indexes this). */
function freeCells(
  width: number,
  height: number,
  occupied: readonly Cell[]
): Cell[] {
  const taken = new Set<string>();
  for (const c of occupied) taken.add(`${c.x},${c.y}`);
  const free: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free;
}

/**
 * Place food on a random empty cell. `occupied` must include the snake body and
 * any active bonus cell so food never lands on the bonus (and vice versa via
 * placeBonus). If the board is full (win), keep a fallback cell.
 */
function placeFood(
  width: number,
  height: number,
  occupied: readonly Cell[],
  seed: number
): { food: Cell; rngSeed: number } {
  const free = freeCells(width, height, occupied);
  if (free.length === 0) {
    const head = occupied[0] ?? { x: 0, y: 0 };
    return { food: head, rngSeed: seed };
  }
  const { value, seed: rngSeed } = nextInt(seed, free.length);
  const food = free[value];
  if (!food) {
    const fallback = free[0] ?? { x: 0, y: 0 };
    return { food: fallback, rngSeed };
  }
  return { food, rngSeed };
}

function placeBonus(
  width: number,
  height: number,
  occupied: readonly Cell[],
  seed: number
): { bonus: BonusFood | null; rngSeed: number } {
  const free = freeCells(width, height, occupied);
  if (free.length === 0) return { bonus: null, rngSeed: seed };
  const { value, seed: rngSeed } = nextInt(seed, free.length);
  const cell = free[value] ?? free[0];
  if (!cell) return { bonus: null, rngSeed };
  return {
    bonus: refreshBonus(cell, BONUS_LIFETIME_MS),
    rngSeed,
  };
}

/** Cells blocked for food placement: snake body + active bonus. */
function foodOccupied(body: readonly Cell[], bonus: BonusFood | null): Cell[] {
  return bonus ? [...body, bonus.cell] : [...body];
}

/** Cells blocked for bonus placement: snake body + normal food. */
function bonusOccupied(body: readonly Cell[], food: Cell): Cell[] {
  return [...body, food];
}

/**
 * Fresh game: length-3 snake centred on the board, heading right, food placed
 * on a free cell.
 */
export function initSnake(
  seed: number,
  options: InitSnakeOptions = {}
): SnakeState {
  const difficulty = options.difficulty ?? "normal";
  // Floor: the length-3 starting snake must fit horizontally from the centre.
  const width = Math.max(5, Math.floor(options.width ?? DEFAULT_SNAKE_WIDTH));
  const height = Math.max(3, Math.floor(options.height ?? DEFAULT_SNAKE_HEIGHT));
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
    dirQueue: [],
    food,
    bonus: null,
    bonusTickCounter: 0,
    alive: true,
    won: false,
    score: 0,
    speed: DIFFICULTIES[difficulty].initialSpeed,
    difficulty,
    rngSeed,
  };
}

/**
 * Buffer a turn for upcoming ticks (up to DIR_QUEUE_MAX deep — oldest dropped
 * when full). Legality is NOT decided here: each tick validates the next queued
 * direction against the direction actually last moved.
 */
export function snakeInput(state: SnakeState, dir: Dir): SnakeState {
  if (!state.alive || state.won) return state;
  const queue = [...state.dirQueue, dir];
  return {
    ...state,
    dirQueue: queue.length > DIR_QUEUE_MAX ? queue.slice(-DIR_QUEUE_MAX) : queue,
  };
}

/**
 * Advance bonus-food wall time deterministically. Pure: given state + dt, the
 * next bonus remaining/value/size is fixed. Emits `bonus-expired` when the
 * timer elapses.
 */
export function snakeAdvanceTime(state: SnakeState, dtMs: number): SnakeStep {
  if (!state.alive || state.won || !state.bonus || dtMs <= 0) {
    return { state, events: [] };
  }
  const remainingMs = state.bonus.remainingMs - dtMs;
  if (remainingMs <= 0) {
    return { state: { ...state, bonus: null }, events: ["bonus-expired"] };
  }
  return {
    state: {
      ...state,
      bonus: refreshBonus(state.bonus.cell, remainingMs),
    },
    events: [],
  };
}

/**
 * Resolve the front of the direction queue against the last actually-moved
 * direction. Returns the new dir and the remaining queue (front always consumed
 * when present — invalid 180s are discarded, not re-queued).
 */
function resolveDir(state: SnakeState): {
  dir: Dir;
  dirQueue: readonly Dir[];
} {
  if (state.dirQueue.length === 0) {
    return { dir: state.dir, dirQueue: state.dirQueue };
  }
  const nextDir = state.dirQueue[0];
  const rest = state.dirQueue.slice(1);
  if (nextDir === undefined) {
    return { dir: state.dir, dirQueue: rest };
  }
  if (nextDir === OPPOSITE[state.dir]) {
    return { dir: state.dir, dirQueue: rest };
  }
  return { dir: nextDir, dirQueue: rest };
}

/**
 * Advance one movement step. Returns the next state plus explicit domain
 * events (eat / bonus / milestone / die / win) so the renderer never re-derives
 * them from state diffs.
 */
export function snakeTick(state: SnakeState): SnakeStep {
  if (!state.alive || state.won) return { state, events: [] };
  const head = state.body[0];
  if (!head) return { state, events: [] };

  const { dir, dirQueue } = resolveDir(state);
  const delta = DELTA[dir];
  const next: Cell = { x: head.x + delta.x, y: head.y + delta.y };

  // Classic snake: the board edge kills.
  if (
    next.x < 0 ||
    next.y < 0 ||
    next.x >= state.width ||
    next.y >= state.height
  ) {
    return {
      state: { ...state, dir, dirQueue, alive: false },
      events: ["die"],
    };
  }

  const onFood = eq(next, state.food);
  const onBonus = state.bonus !== null && eq(next, state.bonus.cell);
  const growing = onFood || onBonus;

  // When not growing, the tail moves away this tick, so colliding with the
  // current tail cell is legal.
  const bodyToCheck = growing ? state.body : state.body.slice(0, -1);
  if (bodyToCheck.some((c) => eq(c, next))) {
    return {
      state: { ...state, dir, dirQueue, alive: false },
      events: ["die"],
    };
  }

  const events: SnakeEvent[] = [];
  let body: readonly Cell[];
  let score = state.score;
  let food = state.food;
  let bonus = state.bonus;
  let rngSeed = state.rngSeed;
  let speed = state.speed;
  let won = false;

  if (growing) {
    body = [next, ...state.body];

    // Explicit overlap: food and bonus on the same cell (should not happen after
    // placement exclusions, but if it does, award both rather than silently
    // clearing the bonus).
    if (onFood) {
      score += FOOD_SCORE;
      speed = speedForScore(score, state.difficulty);
      // Milestone replaces the plain eat blip on multiples of 100.
      events.push(score % 100 === 0 ? "milestone" : "eat");
    }
    if (onBonus && state.bonus) {
      score += state.bonus.value;
      bonus = null;
      events.push("bonus");
    }

    won = body.length >= state.width * state.height;
    if (won) {
      events.push("win");
    } else if (onFood) {
      // Respawn food excluding body AND any remaining bonus cell.
      const placed = placeFood(
        state.width,
        state.height,
        foodOccupied(body, bonus),
        rngSeed
      );
      food = placed.food;
      rngSeed = placed.rngSeed;
    }
  } else {
    body = [next, ...state.body.slice(0, -1)];
  }

  // Bonus spawn counter (per movement tick), only when still alive and not won.
  // Cadence matches the owner's original game (Snake-game/game.js): once the
  // counter passes `bonusFrequency` it re-rolls the 15% chance EVERY tick — a
  // failed roll does NOT reset the counter (only a successful spawn does), so
  // a bonus becomes near-certain shortly after each window. Locked by the
  // "failed roll keeps the counter" test in snake.test.ts.
  let bonusTickCounter = state.bonusTickCounter + 1;
  if (!won && bonus === null) {
    const freq = DIFFICULTIES[state.difficulty].bonusFrequency;
    if (bonusTickCounter >= freq) {
      const roll = nextFloat(rngSeed);
      rngSeed = roll.seed;
      if (roll.value < BONUS_SPAWN_CHANCE) {
        const placed = placeBonus(
          state.width,
          state.height,
          bonusOccupied(body, food),
          rngSeed
        );
        rngSeed = placed.rngSeed;
        if (placed.bonus) {
          bonus = placed.bonus;
          bonusTickCounter = 0;
        }
      }
    }
  }

  return {
    state: {
      ...state,
      dir,
      dirQueue,
      body,
      food,
      bonus,
      bonusTickCounter,
      score,
      speed,
      won,
      alive: true,
      rngSeed,
    },
    events,
  };
}

/**
 * One animation-frame of pure scheduling: interleave wall-clock bonus decay
 * with movement ticks in chronological order so a bonus due to expire mid-frame
 * cannot vanish before a movement tick that was due earlier, and a pickup
 * awards the value at tick time (not end-of-frame).
 *
 * `accMs` is ms accumulated since the last movement tick (carried across frames).
 */
export function snakeFrame(
  state: SnakeState,
  accMs: number,
  dtMs: number
): SnakeFrameResult {
  if (!state.alive || state.won || dtMs <= 0) {
    return { state, accMs: state.alive && !state.won ? accMs : 0, events: [] };
  }

  const events: SnakeEvent[] = [];
  let s = state;
  let acc = Math.max(0, accMs);
  let remaining = dtMs;
  // Bound catch-up so a multi-second stall cannot spin for hundreds of ticks.
  let ticks = 0;
  const maxTicks = 60;

  while (remaining > 0 && s.alive && !s.won && ticks < maxTicks) {
    const interval = tickIntervalMs(s.speed);

    // Movement tick is already due — apply it before more wall time so a
    // pickup sees the value at tick time (not after end-of-frame decay).
    if (acc + 1e-9 >= interval) {
      acc -= interval;
      if (acc < 0) acc = 0;
      const stepped = snakeTick(s);
      s = stepped.state;
      for (const e of stepped.events) events.push(e);
      ticks += 1;
      continue;
    }

    const timeToTick = interval - acc;
    const step = Math.min(timeToTick, remaining);
    if (step <= 0) break;

    const advanced = snakeAdvanceTime(s, step);
    s = advanced.state;
    for (const e of advanced.events) events.push(e);
    acc += step;
    remaining -= step;
  }

  // Cap catch-up: if a long stall left acc above one interval, drop the excess
  // so the next frame does not multi-tick instantly after recovery.
  const cap = tickIntervalMs(s.speed);
  if (acc > cap) acc = 0;

  return { state: s, accMs: acc, events };
}
