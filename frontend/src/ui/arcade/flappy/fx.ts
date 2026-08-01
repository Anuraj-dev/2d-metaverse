/**
 * Renderer-side juice: hit flash, screen shake, the wing-beat phase and the
 * little air puffs behind a flap. Purely cosmetic — none of it feeds back into
 * the pure rules, so it lives with the renderer rather than in game/arcade.
 * Jitter comes from the same deterministic `hash` the scenery uses, so no
 * `Math.random` sneaks into the frame loop.
 */
import type { FlappyPhase } from "../../../game/arcade/flappy";
import { hash } from "./util";

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Seconds it lives for. */
  life: number;
  /** Seconds lived so far. */
  t: number;
}

export interface FlappyFx {
  /** White hit-flash alpha, 0..1. */
  flash: number;
  /** Screen-shake magnitude in world units. */
  shake: number;
  /** Wing-beat phase in radians. */
  wing: number;
  puffs: Puff[];
  /** Jitter counter for puff spawns. */
  spawns: number;
}

const WING_SPEED: Record<FlappyPhase, number> = {
  ready: 8,
  play: 15,
  dying: 2,
  over: 0,
};

const PUFFS_PER_FLAP = 5;

export function createFx(): FlappyFx {
  return { flash: 0, shake: 0, wing: 0, puffs: [], spawns: 0 };
}

/** A crash: flash the screen white and kick the camera. */
export function hitFx(fx: FlappyFx): void {
  fx.flash = 1;
  fx.shake = 12;
}

/** A flap: a small burst of air behind the bird. */
export function emitFlapPuff(fx: FlappyFx, x: number, y: number): void {
  for (let i = 0; i < PUFFS_PER_FLAP; i++) {
    const n = fx.spawns * PUFFS_PER_FLAP + i;
    fx.puffs.push({
      x: x - 20 + (hash(n * 1.7) - 0.5) * 10,
      y: y + 8 + (hash(n * 3.1) - 0.5) * 10,
      vx: -60 - hash(n * 5.3) * 70,
      vy: 30 + hash(n * 7.9) * 70,
      r: 4 + hash(n * 9.4) * 7,
      life: 0.45 + hash(n * 11.6) * 0.3,
      t: 0,
    });
  }
  fx.spawns += 1;
}

export function stepFx(fx: FlappyFx, dt: number, phase: FlappyPhase): void {
  fx.flash = Math.max(0, fx.flash - dt * 3.2);
  fx.shake = Math.max(0, fx.shake - dt * 40);
  fx.wing += dt * WING_SPEED[phase];

  for (let i = fx.puffs.length - 1; i >= 0; i--) {
    const p = fx.puffs[i];
    if (!p) continue;
    p.t += dt;
    if (p.t >= p.life) {
      fx.puffs.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 90 * dt;
  }
}

export function drawPuffs(ctx: CanvasRenderingContext2D, fx: FlappyFx): void {
  for (const p of fx.puffs) {
    const k = 1 - p.t / p.life;
    ctx.fillStyle = `rgba(255,255,255,${k * 0.45})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.5 + k * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
}
