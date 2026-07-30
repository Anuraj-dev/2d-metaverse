/**
 * Shared canvas helpers for the Snake art modules. Drawing only — no game
 * rules live here (those stay in game/arcade/snake.ts).
 */
import type { Dir } from "../../../game/arcade/snake";

/**
 * Reference cell size the original art was authored against. Nothing draws at
 * this size — it exists only so authored pixel values can be expressed as a
 * ratio of the *actual* cell size the host computes for the current viewport.
 */
export const DESIGN_CELL = 20;

export const SNAKE_COLORS = {
  head: "#006400",
  body: "#32CD32",
  bodyAlt: "#228B22",
  outline: "#004d00",
  eye: "white",
  pupil: "black",
  board: "#ffffff",
  gridDot: "rgba(0, 0, 0, 0.2)",
} as const;

/** Cheap deterministic 0..1 noise (stable shake without Math.random). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Path a rounded rectangle (caller fills/strokes it). */
export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.min(radius, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Eye centre offsets (cell-local 0..1) by travel direction. */
export function eyeOffsets(dir: Dir): readonly [number, number][] {
  switch (dir) {
    case "up":
      return [
        [0.3, 0.32],
        [0.7, 0.32],
      ];
    case "down":
      return [
        [0.3, 0.68],
        [0.7, 0.68],
      ];
    case "left":
      return [
        [0.32, 0.3],
        [0.32, 0.7],
      ];
    case "right":
      return [
        [0.68, 0.3],
        [0.68, 0.7],
      ];
  }
}
