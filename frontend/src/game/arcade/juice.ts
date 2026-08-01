/**
 * Arcade juice — pure feedback state (particles, score pop-ups, screen shake).
 *
 * Same contract as every other module under game/arcade: plain values in, plain
 * values out, no Phaser/net/DOM imports, and every random draw threaded through
 * the serializable `rngSeed` (mulberry32) — never `Math.random`. A given seed +
 * the same sequence of spawn/step calls therefore produces byte-identical
 * particle trajectories, which is what juice.test.ts asserts.
 *
 * The renderers own only the drawing: they call `burst`/`popup`/`shake` when a
 * domain event happens, `stepJuice` once per frame, and read `shakeOffset` to
 * translate the canvas. No decision about *whether* to shake lives here — the
 * caller applies the user's shake setting (issue #163) before calling `shake`.
 */
import { nextFloat } from "./prng";

export interface Particle {
  readonly x: number;
  readonly y: number;
  /** Velocity in px per 16ms reference frame. */
  readonly vx: number;
  readonly vy: number;
  /** Remaining lifetime in ms; the particle is dropped at <= 0. */
  readonly life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly color: string;
}

export interface Popup {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly life: number;
  readonly maxLife: number;
  readonly color: string;
}

export interface JuiceState {
  readonly particles: readonly Particle[];
  readonly popups: readonly Popup[];
  /** Shake energy, 0 (still) .. 1 (maximum). Decays exponentially. */
  readonly shake: number;
  /** Monotonic ms clock — drives the deterministic shake wobble. */
  readonly elapsedMs: number;
  readonly rngSeed: number;
}

export interface BurstOptions {
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly color: string;
  /** Peak speed in px per 16ms frame. */
  readonly speed: number;
  readonly life: number;
  readonly size?: number;
  /** Direction bias in radians; omit for a full 360° burst. */
  readonly direction?: number;
  /** Half-angle of the emission cone around `direction`, radians. */
  readonly spread?: number;
}

/**
 * Hard cap on live particles. A long run with fast eating could otherwise grow
 * the array without bound; oldest particles are dropped first.
 */
export const MAX_PARTICLES = 220;

/** Downward acceleration applied per 16ms frame. */
const GRAVITY = 0.12;
/** Velocity retained per 16ms frame (air drag). */
const DRAG = 0.94;
/** Fraction of shake energy remaining after 100ms. */
const SHAKE_DECAY_PER_100MS = 0.18;
/** Pixels of canvas translation at full (1.0) shake energy. */
export const SHAKE_MAX_PX = 7;
/** Pop-ups drift up this many px per 16ms frame. */
const POPUP_RISE = 0.55;

export function initJuice(seed: number): JuiceState {
  return { particles: [], popups: [], shake: 0, elapsedMs: 0, rngSeed: seed };
}

/**
 * Spawn `count` particles from a point. Angles and speeds are drawn from the
 * seeded PRNG, so the burst is reproducible.
 */
export function burst(state: JuiceState, opts: BurstOptions): JuiceState {
  const size = opts.size ?? 2.5;
  const spread = opts.spread ?? Math.PI;
  const spawned: Particle[] = [];
  let seed = state.rngSeed;
  for (let i = 0; i < opts.count; i++) {
    const a = nextFloat(seed);
    seed = a.seed;
    const b = nextFloat(seed);
    seed = b.seed;
    const c = nextFloat(seed);
    seed = c.seed;
    // Full 360° when no direction bias is given, else a cone around it.
    const base = opts.direction ?? 0;
    const angle =
      opts.direction === undefined
        ? a.value * Math.PI * 2
        : base + (a.value * 2 - 1) * spread;
    // sqrt keeps the burst area-uniform instead of clumped at the centre.
    const speed = opts.speed * (0.35 + 0.65 * Math.sqrt(b.value));
    const life = opts.life * (0.7 + 0.6 * c.value);
    spawned.push({
      x: opts.x,
      y: opts.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size,
      color: opts.color,
    });
  }
  const merged = [...state.particles, ...spawned];
  const particles =
    merged.length > MAX_PARTICLES ? merged.slice(merged.length - MAX_PARTICLES) : merged;
  return { ...state, particles, rngSeed: seed };
}

/** Add a floating score pop-up. Deterministic — no random draw. */
export function popup(
  state: JuiceState,
  p: { x: number; y: number; text: string; life?: number; color?: string }
): JuiceState {
  const life = p.life ?? 700;
  return {
    ...state,
    popups: [
      ...state.popups,
      { x: p.x, y: p.y, text: p.text, life, maxLife: life, color: p.color ?? "#f2c14e" },
    ],
  };
}

/** Add shake energy (clamped to 1). Callers gate this on the user's setting. */
export function shake(state: JuiceState, amount: number): JuiceState {
  return { ...state, shake: Math.min(1, Math.max(0, state.shake + amount)) };
}

/** Advance particles, pop-ups, shake decay and the clock by `dtMs`. */
export function stepJuice(state: JuiceState, dtMs: number): JuiceState {
  const dt = Math.max(0, dtMs);
  const f = dt / 16;
  const particles: Particle[] = [];
  for (const p of state.particles) {
    const life = p.life - dt;
    if (life <= 0) continue;
    const vx = p.vx * Math.pow(DRAG, f);
    const vy = p.vy * Math.pow(DRAG, f) + GRAVITY * f;
    particles.push({ ...p, x: p.x + vx * f, y: p.y + vy * f, vx, vy, life });
  }
  const popups: Popup[] = [];
  for (const u of state.popups) {
    const life = u.life - dt;
    if (life <= 0) continue;
    popups.push({ ...u, y: u.y - POPUP_RISE * f, life });
  }
  const decayed = state.shake * Math.pow(SHAKE_DECAY_PER_100MS, dt / 100);
  return {
    ...state,
    particles,
    popups,
    shake: decayed < 0.002 ? 0 : decayed,
    elapsedMs: state.elapsedMs + dt,
  };
}

/**
 * Deterministic camera offset for the current shake energy. Uses the clock, not
 * the PRNG, so reading the offset never advances game randomness (it can be
 * called any number of times per frame).
 */
export function shakeOffset(
  state: JuiceState,
  magnitudePx = SHAKE_MAX_PX
): { x: number; y: number } {
  if (state.shake <= 0) return { x: 0, y: 0 };
  const t = state.elapsedMs;
  const amp = state.shake * magnitudePx;
  return {
    x: Math.sin(t * 0.081) * Math.cos(t * 0.037) * amp,
    y: Math.cos(t * 0.063) * Math.sin(t * 0.029) * amp,
  };
}

/** Alpha for a particle/pop-up, fading out over the last of its life. */
export function fadeAlpha(life: number, maxLife: number): number {
  if (maxLife <= 0) return 0;
  return Math.max(0, Math.min(1, life / maxLife));
}
