/**
 * Remote-player interpolation: pure current+target → smoothed step + moving flag.
 *
 * Extracted from WorldScene.updateRemotes. Each frame the scene eases every remote
 * sprite a fraction of the way toward its last reported position; the `moving` flag
 * drives walk-vs-idle animation. Facing is *not* derived here — it comes straight
 * from the remote's reported direction — so this stays a position-only concern.
 */

/** Fraction of the remaining gap closed each frame (exponential smoothing). */
export const REMOTE_LERP = 0.2;
/** Below this per-axis delta the remote is treated as standing still. */
export const REMOTE_MOVE_EPSILON = 0.5;

export interface Vec2 {
  x: number;
  y: number;
}

export interface InterpStep {
  x: number;
  y: number;
  moving: boolean;
}

/**
 * Ease `cur` toward `target` by `lerp`. `moving` reflects the pre-step gap, so a
 * sprite that has effectively arrived (within the epsilon on both axes) reads as
 * idle even though a sub-pixel correction still applies.
 */
export function interpolateStep(
  cur: Vec2,
  target: Vec2,
  lerp: number = REMOTE_LERP
): InterpStep {
  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  const moving =
    Math.abs(dx) > REMOTE_MOVE_EPSILON || Math.abs(dy) > REMOTE_MOVE_EPSILON;
  return { x: cur.x + dx * lerp, y: cur.y + dy * lerp, moving };
}
