/**
 * Movement intent: pure input-state → velocity/direction/animation-choice.
 *
 * Extracted from WorldScene so movement can be reasoned about (and regression
 * tested) without booting Phaser. The scene reads raw key/joystick state, hands
 * it here, and applies the result to the physics body + animations. It owns no
 * gameplay decisions of its own beyond the freeze cases (seated / typing), which
 * short-circuit before this function is ever called.
 */
import type { Dir } from "../contract";

/** Base walking speed in px/s (matches the scene's historical constant). */
export const BASE_SPEED = 120;
/** Sprint multiplier applied while the run key (Shift) is held. */
export const RUN_MULTIPLIER = 1.6;
/** Below this speed magnitude the avatar is considered idle. */
export const MOVING_EPSILON = 0.01;

export interface MovementInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Sprint (Shift) held. */
  run: boolean;
  /**
   * On-screen joystick axis. When either component is non-zero it overrides the
   * keyboard entirely (mobile takes precedence), and may be fractional.
   */
  touchAxis: { x: number; y: number };
}

export interface MovementResult {
  vx: number;
  vy: number;
  /** Facing after this frame — unchanged from `currentDir` while idle. */
  dir: Dir;
  moving: boolean;
}

/**
 * Resolve directional input into a velocity vector, a facing, and a moving flag.
 * Diagonal input is clamped to `speed` so diagonals aren't faster; facing is only
 * updated while moving, and prefers the dominant axis (the vertical axis wins
 * ties, since the test is a strict `abs(vx) > abs(vy)`).
 */
export function movementIntent(
  input: MovementInput,
  currentDir: Dir,
  baseSpeed: number = BASE_SPEED
): MovementResult {
  const speed = input.run ? baseSpeed * RUN_MULTIPLIER : baseSpeed;

  let ax = 0;
  let ay = 0;
  if (input.left) ax -= 1;
  if (input.right) ax += 1;
  if (input.up) ay -= 1;
  if (input.down) ay += 1;

  // Joystick overrides keyboard when engaged.
  if (input.touchAxis.x !== 0 || input.touchAxis.y !== 0) {
    ax = input.touchAxis.x;
    ay = input.touchAxis.y;
  }

  let vx = ax * speed;
  let vy = ay * speed;
  const mag = Math.hypot(vx, vy);
  if (mag > speed) {
    vx = (vx / mag) * speed;
    vy = (vy / mag) * speed;
  }

  const moving = mag > MOVING_EPSILON;
  let dir = currentDir;
  if (moving) {
    if (Math.abs(vx) > Math.abs(vy)) dir = vx < 0 ? "left" : "right";
    else dir = vy < 0 ? "up" : "down";
  }

  return { vx, vy, dir, moving };
}
