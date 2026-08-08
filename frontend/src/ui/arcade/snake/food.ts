/**
 * Normal food (pulsing red) + bonus food (orange sparkle + top timer bar).
 * Sizes are stored as fractions of a cell, so the art scales with whatever
 * cell size the host computes for the current stage.
 */
import {
  BONUS_LIFETIME_MS,
  type BonusFood,
  type Cell,
} from "../../../game/arcade/snake";
import { DESIGN_CELL } from "./util";

export interface FoodAnim {
  /** Current drawn radius of the normal food pellet, as a fraction of a cell. */
  radius: number;
  /** Pulse step per frame (fraction of a cell); sign flips at the bounds. */
  radiusDir: number;
  minRadius: number;
  maxRadius: number;
}

export function createFoodAnim(): FoodAnim {
  // 8 / 6 / 10 px against the original 20px grid.
  return { radius: 0.4, radiusDir: 0.01, minRadius: 0.3, maxRadius: 0.5 };
}

/** Step the food pulse (visual only — no game state). */
export function stepFoodAnim(anim: FoodAnim): void {
  anim.radius += anim.radiusDir;
  if (anim.radius >= anim.maxRadius || anim.radius <= anim.minRadius) {
    anim.radiusDir *= -1;
  }
}

export function drawFood(
  ctx: CanvasRenderingContext2D,
  food: Cell,
  anim: FoodAnim,
  cell: number
): void {
  const cx = food.x * cell + cell / 2;
  const cy = food.y * cell + cell / 2;
  const r = Math.max(1, anim.radius * cell);

  const gradient = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
  gradient.addColorStop(0, "#ff0000");
  gradient.addColorStop(1, "#990000");

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // White highlight.
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.35, r / 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();
}

export function drawBonusFood(
  ctx: CanvasRenderingContext2D,
  bonus: BonusFood,
  nowMs: number,
  cell: number
): void {
  const cx = bonus.cell.x * cell + cell / 2;
  const cy = bonus.cell.y * cell + cell / 2;
  // Size is authored in original "pixel" units at gridSize=20; scale relative
  // to the live cell, but keep the orb inside the ONE cell its eat-hitbox
  // occupies — a spill-over orb reads as edible from the side when it isn't.
  const size = Math.min(
    cell * 0.45,
    Math.max(cell * 0.2, (bonus.size / DESIGN_CELL) * cell * 0.45)
  );

  const gradient = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, size);
  gradient.addColorStop(0, "#ffcc00");
  gradient.addColorStop(0.7, "#ff6600");
  gradient.addColorStop(1, "#ff3300");

  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(1, cell * 0.1);
  ctx.stroke();

  const sparkleAngle = (nowMs / 200) % (Math.PI * 2);
  const sparkleX = cx + Math.cos(sparkleAngle) * size * 0.7;
  const sparkleY = cy + Math.sin(sparkleAngle) * size * 0.7;
  ctx.beginPath();
  ctx.arc(sparkleX, sparkleY, size / 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fill();
}

/** Top timer bar: width = remaining lifetime fraction. */
export function drawBonusTimer(
  ctx: CanvasRenderingContext2D,
  bonus: BonusFood,
  boardWidthPx: number,
  cell: number
): void {
  const timeRatio = Math.max(0, Math.min(1, bonus.remainingMs / BONUS_LIFETIME_MS));
  const barWidth = boardWidthPx * timeRatio;
  const barHeight = Math.max(2, cell * 0.25);

  ctx.fillStyle = "rgba(200, 200, 200, 0.5)";
  ctx.fillRect(0, 0, boardWidthPx, barHeight);

  const timerGradient = ctx.createLinearGradient(0, 0, Math.max(1, barWidth), 0);
  timerGradient.addColorStop(0, "rgba(0, 150, 255, 0.9)");
  timerGradient.addColorStop(1, "rgba(0, 80, 200, 0.9)");
  ctx.fillStyle = timerGradient;
  ctx.fillRect(0, 0, barWidth, barHeight);
}
