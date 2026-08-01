/**
 * Flappy — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. Pipe gaps are
 * drawn from the seeded PRNG in `rngSeed`, so a seed + flap script reproduces a
 * run exactly (see flappy.test.ts). The renderer draws `birdY`/`pipes` and calls
 * `flappyTick` on a fixed timestep (`FLAPPY_STEP`); a flap is a discrete
 * `flappyFlap` input.
 *
 * Physics are expressed in world units per SECOND and integrated with an
 * explicit `dt`, so the feel is frame-rate independent; the renderer runs a
 * fixed-step accumulator to keep it deterministic.
 *
 * World coordinates: a fixed grid `width`×`height`, origin top-left, `y` down.
 * `groundY` is the top of the ground strip — the bird dies on touching it. The
 * bird sits at a fixed `birdX` and only moves vertically.
 *
 * Phases: `ready` (bird bobs, no pipes) → `play` → `dying` (the bird tumbles
 * after a hit while the world holds still) → `over`. The renderer reports
 * game-over to the overlay when the phase reaches `over`, so the death tumble
 * plays out before the overlay's panel appears.
 *
 * Difficulty is one continuous ramp (Chrome-Dino style, no discrete levels):
 * a single parameter `t = min(1, score / RAMP_END_SCORE)` lerps every course
 * knob — scroll speed, gap height, pipe spacing — from a gentle start config
 * to the end config, then plateaus. Physics (gravity/flap) never change, so
 * the bird feels identical across the whole run. Each cleared pipe awards
 * POINTS_PER_PIPE points.
 */
import { nextFloat } from "./prng";

export type FlappyPhase = "ready" | "play" | "dying" | "over";

export interface Pipe {
  /** Left edge x of the pipe column. */
  readonly x: number;
  /** Top y of the gap opening. */
  readonly top: number;
  /** Height of the gap opening (shrinks as the score climbs). */
  readonly gap: number;
  /** True once the bird has passed this pipe and scored it. */
  readonly scored: boolean;
}

export interface FlappyState {
  readonly width: number;
  readonly height: number;
  /** Top of the ground strip; the play area is 0..groundY. */
  readonly groundY: number;
  readonly birdX: number;
  readonly birdY: number;
  /** Vertical velocity, units/s (positive = falling). */
  readonly vy: number;
  /** Body rotation in radians, purely a function of the flight so far. */
  readonly rot: number;
  readonly gravity: number;
  readonly flapVelocity: number;
  readonly maxFall: number;
  /** Pipe scroll speed at ramp start / end (units/s); lerped by score. */
  readonly speedStart: number;
  readonly speedEnd: number;
  readonly pipeWidth: number;
  /** Distance between consecutive pipe columns at ramp start / end. */
  readonly spacingStart: number;
  readonly spacingEnd: number;
  /** Gap opening height at ramp start / end. */
  readonly gapStart: number;
  readonly gapEnd: number;
  readonly birdRadius: number;
  /** Dying below this y (above the top edge) counts as a crash. */
  readonly ceiling: number;
  readonly pipes: readonly Pipe[];
  readonly phase: FlappyPhase;
  readonly score: number;
  /** Elapsed seconds; drives the ready-screen bob and cosmetic drift. */
  readonly time: number;
  /** Total world scroll distance; drives the parallax backdrop. */
  readonly scroll: number;
  readonly rngSeed: number;
}

/** Physics step the renderer feeds `flappyTick`. */
export const FLAPPY_STEP = 1 / 120;

export const DEFAULT_FLAPPY_CONFIG = {
  width: 1200,
  /** Design height of the world; the width follows the surface's aspect. */
  height: 800,
  /** Play area never gets narrower than this (very tall/thin surfaces). */
  minWidth: 340,
  /** …nor wider than this (ultra-wide surfaces shrink the height instead). */
  maxWidth: 1400,
  /** Height of the ground strip along the bottom. */
  groundHeight: 132,
  /** The bird sits this far across the play area. */
  birdXFrac: 0.3,
  gravity: 1980,
  flapVelocity: -612,
  maxFall: 1000,
  speedStart: 160,
  speedEnd: 196,
  pipeWidth: 84,
  spacingStart: 330,
  spacingEnd: 272,
  gapStart: 245,
  gapEnd: 158,
  /** Collision radius. Kept in lockstep with the drawn bird (BIRD_SCALE in
   *  ui/arcade/flappy/bird.ts) so the art never outgrows its hitbox. */
  birdRadius: 17,
  ceiling: -90,
} as const;

/** Points awarded per cleared pipe. */
export const POINTS_PER_PIPE = 10;
/** Score at which the difficulty ramp completes (= 40 pipes cleared). */
export const RAMP_END_SCORE = 400;

/** Vertical margin kept clear of the top/ground when placing a gap. */
const GAP_MARGIN = 70;
/** Backdrop keeps drifting on the ready screen, at a fraction of play speed. */
const READY_SCROLL_FACTOR = 0.55;
const READY_BOB_RATE = 2.9;
const READY_BOB_AMPLITUDE = 13;
/** Pipes are dropped once this far past the left edge. */
const DESPAWN_MARGIN = 80;
/** A hit kicks the bird upward before the tumble. */
const DEATH_KICK = -180;
/** Gravity multiplier while tumbling. */
const DYING_GRAVITY = 1.05;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Ramp progress for a score: 0 at the start, 1 once the plateau is reached. */
function rampT(score: number): number {
  return Math.min(1, score / RAMP_END_SCORE);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pipe scroll speed (units/s) at this score. */
export function flappySpeedForScore(state: FlappyState, score: number): number {
  return lerp(state.speedStart, state.speedEnd, rampT(score));
}

/** Height of the gap a pipe spawned at this score gets. */
function gapForScore(state: FlappyState, score: number): number {
  return lerp(state.gapStart, state.gapEnd, rampT(score));
}

/** Column-to-column spacing a pipe spawned at this score gets. */
function spacingForScore(state: FlappyState, score: number): number {
  return lerp(state.spacingStart, state.spacingEnd, rampT(score));
}

function spawnPipe(
  state: FlappyState,
  x: number,
  score: number,
  seed: number
): { pipe: Pipe; rngSeed: number } {
  const gap = gapForScore(state, score);
  const minTop = GAP_MARGIN;
  const maxTop = Math.max(minTop, state.groundY - gap - GAP_MARGIN);
  const { value, seed: rngSeed } = nextFloat(seed);
  return {
    pipe: { x, top: minTop + value * (maxTop - minTop), gap, scored: false },
    rngSeed,
  };
}

/** Fresh game: bird bobbing on the ready screen, no pipes, awaiting a flap. */
export function initFlappy(
  seed: number,
  config = DEFAULT_FLAPPY_CONFIG
): FlappyState {
  const groundY = config.height - config.groundHeight;
  return {
    width: config.width,
    height: config.height,
    groundY,
    birdX: config.width * config.birdXFrac,
    birdY: groundY * 0.46,
    vy: 0,
    rot: 0,
    gravity: config.gravity,
    flapVelocity: config.flapVelocity,
    maxFall: config.maxFall,
    speedStart: config.speedStart,
    speedEnd: config.speedEnd,
    pipeWidth: config.pipeWidth,
    spacingStart: config.spacingStart,
    spacingEnd: config.spacingEnd,
    gapStart: config.gapStart,
    gapEnd: config.gapEnd,
    birdRadius: config.birdRadius,
    ceiling: config.ceiling,
    pipes: [],
    phase: "ready",
    score: 0,
    time: 0,
    scroll: 0,
    rngSeed: seed,
  };
}

/** Lift any gap that a shorter play area would have pushed into the ground. */
function refitPipes(pipes: readonly Pipe[], groundY: number): readonly Pipe[] {
  let changed = false;
  const next = pipes.map((pipe) => {
    const maxTop = Math.max(GAP_MARGIN, groundY - pipe.gap - GAP_MARGIN);
    if (pipe.top <= maxTop) return pipe;
    changed = true;
    return { ...pipe, top: maxTop };
  });
  return changed ? next : pipes;
}

/**
 * Fit the world to a new surface size (the renderer fills its container, so the
 * play area's aspect follows the screen). The ground keeps its thickness, the
 * bird keeps its fraction across the field, and every live pipe shifts by the
 * same delta the bird moved — bird-to-pipe distances are preserved exactly, so a
 * resize mid-run nudges the layout without restarting it and can never
 * teleport the bird into (or past) a column. Gaps are never left stranded
 * below the new ground.
 */
export function flappyResize(
  state: FlappyState,
  width: number,
  height: number
): FlappyState {
  if (width === state.width && height === state.height) return state;
  const groundY = height - (state.height - state.groundY);
  const birdX = width * DEFAULT_FLAPPY_CONFIG.birdXFrac;
  const dx = birdX - state.birdX;
  const shifted =
    dx === 0
      ? state.pipes
      : state.pipes.map((pipe) => ({ ...pipe, x: pipe.x + dx }));
  const birdY =
    state.phase === "ready"
      ? groundY * 0.46
      : Math.min(state.birdY, groundY - state.birdRadius - 1);
  return {
    ...state,
    width,
    height,
    groundY,
    birdX,
    birdY,
    pipes: refitPipes(shifted, groundY),
  };
}

/** The pipe field the run starts with: a column per start-spacing, off-screen. */
function firstPipes(state: FlappyState): { pipes: Pipe[]; rngSeed: number } {
  const pipes: Pipe[] = [];
  let rngSeed = state.rngSeed;
  const startX = state.width + 60;
  const spacing = spacingForScore(state, 0);
  const count = Math.ceil(state.width / spacing) + 2;
  for (let i = 0; i < count; i++) {
    const spawned = spawnPipe(state, startX + i * spacing, 0, rngSeed);
    pipes.push(spawned.pipe);
    rngSeed = spawned.rngSeed;
  }
  return { pipes, rngSeed };
}

/**
 * Apply a flap: sets upward velocity and, on the ready screen, starts the run
 * (which lays out the first pipes). A tumbling or finished bird ignores flaps.
 */
export function flappyFlap(state: FlappyState): FlappyState {
  if (state.phase === "play") return { ...state, vy: state.flapVelocity };
  if (state.phase !== "ready") return state;
  const { pipes, rngSeed } = firstPipes(state);
  return { ...state, phase: "play", vy: state.flapVelocity, pipes, rngSeed };
}

function hitsRect(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** True when the bird's circle overlaps any pipe column. */
function hitsPipes(state: FlappyState, pipes: readonly Pipe[], birdY: number): boolean {
  const r = state.birdRadius;
  for (const pipe of pipes) {
    if (pipe.x > state.birdX + r || pipe.x + state.pipeWidth < state.birdX - r) continue;
    const bottom = pipe.top + pipe.gap;
    if (
      hitsRect(state.birdX, birdY, r, pipe.x, -400, state.pipeWidth, pipe.top + 400) ||
      hitsRect(
        state.birdX,
        birdY,
        r,
        pipe.x,
        bottom,
        state.pipeWidth,
        state.groundY - bottom + 10
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Bird body rotation: snaps up on a flap, tips forward while diving. */
function nextRotation(state: FlappyState, vy: number, dt: number): number {
  const target =
    vy < 0 ? -0.52 : clamp(vy / state.maxFall, 0, 1) * 1.45 - 0.18;
  const rate = vy < 0 ? 16 : 6.5;
  return state.rot + (target - state.rot) * Math.min(1, rate * dt);
}

function stepPlay(state: FlappyState, dt: number, time: number): FlappyState {
  const vy = Math.min(state.vy + state.gravity * dt, state.maxFall);
  const birdY = state.birdY + vy * dt;
  const speed = flappySpeedForScore(state, state.score);

  // Scroll pipes, score the ones the bird has cleared, drop the ones behind.
  let score = state.score;
  const pipes: Pipe[] = [];
  for (const pipe of state.pipes) {
    const x = pipe.x - speed * dt;
    if (x + state.pipeWidth < -DESPAWN_MARGIN) continue;
    const scored = pipe.scored || x + state.pipeWidth < state.birdX;
    if (scored && !pipe.scored) score += POINTS_PER_PIPE;
    pipes.push({ x, top: pipe.top, gap: pipe.gap, scored });
  }

  // Keep the field topped up ahead of the bird.
  let rngSeed = state.rngSeed;
  const spacing = spacingForScore(state, score);
  const last = pipes[pipes.length - 1];
  if (!last || last.x < state.width - spacing) {
    const x = (last ? last.x : state.width) + spacing;
    const spawned = spawnPipe(state, x, score, rngSeed);
    pipes.push(spawned.pipe);
    rngSeed = spawned.rngSeed;
  }

  const next: FlappyState = {
    ...state,
    time,
    scroll: state.scroll + speed * dt,
    vy,
    birdY,
    rot: nextRotation(state, vy, dt),
    pipes,
    score,
    rngSeed,
  };

  // Hitting the ground ends the run outright — there is nowhere left to tumble.
  if (birdY + state.birdRadius >= state.groundY) {
    return {
      ...next,
      birdY: state.groundY - state.birdRadius,
      rot: Math.PI / 2,
      phase: "over",
    };
  }
  if (birdY < state.ceiling || hitsPipes(state, pipes, birdY)) {
    return { ...next, phase: "dying", vy: Math.min(vy, DEATH_KICK) };
  }
  return next;
}

function stepDying(state: FlappyState, dt: number, time: number): FlappyState {
  const vy = Math.min(state.vy + state.gravity * DYING_GRAVITY * dt, state.maxFall);
  const birdY = state.birdY + vy * dt;
  const rot = state.rot + Math.min(1, 7 * dt) * (Math.PI / 2 - state.rot);
  if (birdY + state.birdRadius >= state.groundY) {
    return {
      ...state,
      time,
      vy,
      birdY: state.groundY - state.birdRadius,
      rot: Math.PI / 2,
      phase: "over",
    };
  }
  return { ...state, time, vy, birdY, rot };
}

/**
 * Advance one step of `dt` seconds:
 *  - `ready`: the bird bobs in place and the backdrop drifts; no pipes.
 *  - `play`: gravity integrates velocity → position, pipes scroll and score,
 *    a crash drops into `dying` (or straight to `over` on the ground).
 *  - `dying`: the bird tumbles to the ground while the world holds still.
 *  - `over`: only the clock advances (idempotent for gameplay).
 */
export function flappyTick(state: FlappyState, dt: number = FLAPPY_STEP): FlappyState {
  const time = state.time + dt;
  switch (state.phase) {
    case "ready":
      return {
        ...state,
        time,
        scroll: state.scroll + state.speedStart * READY_SCROLL_FACTOR * dt,
        birdY:
          state.groundY * 0.46 + Math.sin(time * READY_BOB_RATE) * READY_BOB_AMPLITUDE,
        rot: Math.sin(time * READY_BOB_RATE + Math.PI / 2) * 0.13,
      };
    case "play":
      return stepPlay(state, dt, time);
    case "dying":
      return stepDying(state, dt, time);
    case "over":
      return { ...state, time };
  }
}
