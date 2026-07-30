/**
 * Composes one Snake frame: white board + dot grid → bonus timer → food →
 * bonus → snake → death flash. Draw-only; it never mutates game state.
 *
 * `cell` is the cell size in DEVICE pixels (a FIXED 20 CSS px × dpr — cells are
 * never scaled to fit, the board just gets more of them). The canvas transform
 * stays identity — every module scales off `cell` instead, so lines and dots
 * land on device pixels.
 */
import type { Cell, Dir, SnakeState } from "../../../game/arcade/snake";
import { drawBoard } from "./grid";
import { drawSnake } from "./snakeBody";
import {
  drawBonusFood,
  drawBonusTimer,
  drawFood,
  stepFoodAnim,
  type FoodAnim,
} from "./food";
import { deathSnakeAlpha, flashOpacity, shakeOffset, type SnakeFx } from "./fx";

export function renderSnake(
  ctx: CanvasRenderingContext2D,
  state: SnakeState,
  fx: SnakeFx,
  foodAnim: FoodAnim,
  nowMs: number,
  cell: number,
  body: readonly Cell[] = state.body,
  dir: Dir = state.dir
): void {
  const boardW = state.width * cell;
  const boardH = state.height * cell;

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Base wash so a shake offset never exposes the previous frame at the edges.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, boardW, boardH);

  const shake = shakeOffset(fx, cell);
  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawBoard(ctx, state.width, state.height, cell);

  // Pulse food only while the run is live (not during death settle).
  if (state.alive && !state.won && !fx.animating) {
    stepFoodAnim(foodAnim);
  }

  if (state.bonus) {
    drawBonusTimer(ctx, state.bonus, boardW, cell);
  }

  drawFood(ctx, state.food, foodAnim, cell);

  if (state.bonus) {
    drawBonusFood(ctx, state.bonus, nowMs, cell);
  }

  drawSnake(ctx, body, dir, cell, deathSnakeAlpha(fx));

  const flash = flashOpacity(fx);
  if (flash > 0.001) {
    ctx.fillStyle = `rgba(255, 0, 0, ${flash})`;
    ctx.fillRect(0, 0, boardW, boardH);
  }

  ctx.restore();
}
