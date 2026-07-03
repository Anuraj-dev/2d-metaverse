/**
 * Flappy — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. Pipe gaps are
 * drawn from the seeded PRNG in `rngSeed`, so a seed + flap script reproduces a
 * run exactly (see flappy.test.ts). The scene renders `birdY`/`pipes` and calls
 * `flappyTick` on a fixed cadence; a flap is a discrete `flappyFlap` input.
 *
 * World coordinates: a fixed grid `width`×`height`, origin top-left, `y` down.
 * The bird sits at a fixed `birdX` and only moves vertically.
 */
import { nextInt } from "./prng";

export interface Pipe {
  /** Left edge x of the pipe column. */
  readonly x: number;
  /** Top y of the gap opening. */
  readonly gapY: number;
  /** True once the bird has passed this pipe and scored it. */
  readonly scored: boolean;
}

export interface FlappyState {
  readonly width: number;
  readonly height: number;
  readonly birdX: number;
  readonly birdY: number;
  readonly vy: number;
  readonly gravity: number;
  readonly flapVelocity: number;
  readonly birdRadius: number;
  readonly pipeWidth: number;
  readonly pipeGap: number;
  readonly pipeSpeed: number;
  /** Ticks between pipe spawns. */
  readonly pipeInterval: number;
  readonly pipes: readonly Pipe[];
  readonly alive: boolean;
  readonly started: boolean;
  readonly score: number;
  readonly tick: number;
  readonly rngSeed: number;
}

export const DEFAULT_FLAPPY_CONFIG = {
  width: 240,
  height: 320,
  birdX: 70,
  gravity: 0.45,
  flapVelocity: -6,
  birdRadius: 8,
  pipeWidth: 36,
  pipeGap: 96,
  pipeSpeed: 2,
  pipeInterval: 80,
} as const;

/** Vertical margin kept clear of the top/bottom when placing a gap. */
const GAP_MARGIN = 24;

function spawnPipe(
  width: number,
  height: number,
  pipeGap: number,
  seed: number
): { pipe: Pipe; rngSeed: number } {
  const span = Math.max(1, height - pipeGap - GAP_MARGIN * 2);
  const { value, seed: rngSeed } = nextInt(seed, span);
  return {
    pipe: { x: width, gapY: GAP_MARGIN + value, scored: false },
    rngSeed,
  };
}

/** Fresh game: bird centred, no pipes yet, waiting for the first flap. */
export function initFlappy(
  seed: number,
  config = DEFAULT_FLAPPY_CONFIG
): FlappyState {
  return {
    width: config.width,
    height: config.height,
    birdX: config.birdX,
    birdY: Math.floor(config.height / 2),
    vy: 0,
    gravity: config.gravity,
    flapVelocity: config.flapVelocity,
    birdRadius: config.birdRadius,
    pipeWidth: config.pipeWidth,
    pipeGap: config.pipeGap,
    pipeSpeed: config.pipeSpeed,
    pipeInterval: config.pipeInterval,
    pipes: [],
    alive: true,
    started: false,
    score: 0,
    tick: 0,
    rngSeed: seed,
  };
}

/**
 * Apply a flap: sets upward velocity and, on the first flap, starts the run
 * (pipes only begin advancing once started). A dead bird ignores flaps.
 */
export function flappyFlap(state: FlappyState): FlappyState {
  if (!state.alive) return state;
  return { ...state, vy: state.flapVelocity, started: true };
}

function collides(state: FlappyState, birdY: number): boolean {
  // Ground / ceiling.
  if (birdY - state.birdRadius < 0) return true;
  if (birdY + state.birdRadius > state.height) return true;
  // Pipes: bird is a circle approximated by its bounding box on x.
  const left = state.birdX - state.birdRadius;
  const right = state.birdX + state.birdRadius;
  for (const pipe of state.pipes) {
    const overlapsX = right > pipe.x && left < pipe.x + state.pipeWidth;
    if (!overlapsX) continue;
    const inGap =
      birdY - state.birdRadius >= pipe.gapY &&
      birdY + state.birdRadius <= pipe.gapY + state.pipeGap;
    if (!inGap) return true;
  }
  return false;
}

/**
 * Advance one step:
 *  - before the first flap the bird hovers (no gravity, no pipes).
 *  - otherwise gravity integrates velocity → position, pipes scroll left,
 *    off-screen pipes are dropped, new pipes spawn on cadence, passed pipes
 *    score, and any collision kills the bird.
 * A dead bird is an idempotent no-op.
 */
export function flappyTick(state: FlappyState): FlappyState {
  if (!state.alive) return state;
  if (!state.started) return { ...state, tick: state.tick + 1 };

  const vy = state.vy + state.gravity;
  const birdY = state.birdY + vy;
  const tick = state.tick + 1;

  // Scroll + drop off-screen pipes.
  let scored = state.score;
  const moved: Pipe[] = [];
  for (const pipe of state.pipes) {
    const x = pipe.x - state.pipeSpeed;
    if (x + state.pipeWidth < 0) continue;
    const passed = !pipe.scored && x + state.pipeWidth < state.birdX;
    if (passed) scored += 1;
    moved.push({ x, gapY: pipe.gapY, scored: pipe.scored || passed });
  }

  let rngSeed = state.rngSeed;
  if (tick % state.pipeInterval === 0) {
    const { pipe, rngSeed: seed } = spawnPipe(
      state.width,
      state.height,
      state.pipeGap,
      rngSeed
    );
    moved.push(pipe);
    rngSeed = seed;
  }

  const dead = collides({ ...state, pipes: moved }, birdY);
  return {
    ...state,
    vy,
    birdY,
    tick,
    pipes: moved,
    score: scored,
    rngSeed,
    alive: !dead,
  };
}
