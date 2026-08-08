/**
 * Game-over shake + red flash (visual only). Driven by elapsed wall time so
 * duration is stable across 60/144 Hz and under throttling. The overlay owns
 * the final "Game over / Play again" panel — this only keeps the visual death
 * feedback playing after the renderer reports the terminal state.
 */
import { hash } from "./util";

/** ~50 frames at 60 Hz — the original's MAX_GAME_OVER_FRAMES pacing. */
export const GAME_OVER_DURATION_MS = 830;

/** Shake fades out over this fraction of the total duration. */
const SHAKE_END = 30 / 50;
/** Intense flash window as a fraction of total duration. */
const FLASH_PULSE_END = 35 / 50;

export interface SnakeFx {
  /** Elapsed ms into the death animation. */
  elapsedMs: number;
  /** True while the death animation is running. */
  animating: boolean;
  /** Set once the animation finishes so the visual effect settles once. */
  settled: boolean;
}

export function createFx(): SnakeFx {
  return { elapsedMs: 0, animating: false, settled: false };
}

/** Start the death animation (idempotent). */
export function startGameOverFx(fx: SnakeFx): void {
  if (fx.animating || fx.settled) return;
  fx.animating = true;
  fx.elapsedMs = 0;
  fx.settled = false;
}

/**
 * Advance the death animation by `dtMs`. Returns true the first time it
 * settles.
 */
export function stepGameOverFx(fx: SnakeFx, dtMs: number): boolean {
  if (!fx.animating || fx.settled) return false;
  fx.elapsedMs += Math.max(0, dtMs);
  if (fx.elapsedMs >= GAME_OVER_DURATION_MS) {
    fx.elapsedMs = GAME_OVER_DURATION_MS;
    fx.animating = false;
    fx.settled = true;
    return true;
  }
  return false;
}

function progress(fx: SnakeFx): number {
  return Math.min(1, fx.elapsedMs / GAME_OVER_DURATION_MS);
}

/**
 * Shake offset (px) for the current death progress. Scaled by the live cell
 * size (15px against the original 20px grid) so the sting reads the same at
 * any board scale.
 */
export function shakeOffset(
  fx: SnakeFx,
  cell: number,
  enabled = true,
): { x: number; y: number } {
  if (!enabled || !fx.animating) return { x: 0, y: 0 };
  const p = progress(fx);
  if (p >= SHAKE_END) return { x: 0, y: 0 };
  const maxShake = cell * 0.75;
  const amount = maxShake * (1 - p / SHAKE_END);
  // Deterministic "random" keyed by elapsed ms so a given time is stable.
  const t = fx.elapsedMs;
  const dx = (hash(t * 17.3) * 2 - 1) * amount;
  const dy = (hash(t * 31.7 + 3) * 2 - 1) * amount;
  return { x: dx, y: dy };
}

/** Red flash opacity for the current death progress (0 = none). */
export function flashOpacity(fx: SnakeFx, enabled = true): number {
  if (!enabled) return 0;
  if (!fx.animating && !fx.settled) return 0;
  if (!fx.animating) return 0;
  const p = progress(fx);
  // Approximate the original frame-based pulse with time-based phases.
  if (p < FLASH_PULSE_END) {
    // Alternate ~every 4 frames at 60Hz ≈ 66ms.
    const phase = Math.floor(fx.elapsedMs / 66) % 2;
    if (phase === 0) {
      return Math.min(0.8, 0.4 + 0.4 * Math.sin(fx.elapsedMs / 32));
    }
    return 0;
  }
  const fadeT = (p - FLASH_PULSE_END) / (1 - FLASH_PULSE_END);
  return Math.max(0, 0.3 * (1 - fadeT));
}

/** Snake draw alpha during death (matches original 0.8 → 0.4 cutover). */
export function deathSnakeAlpha(fx: SnakeFx): number {
  if (!fx.animating) return 1;
  return progress(fx) < SHAKE_END ? 0.8 : 0.4;
}
