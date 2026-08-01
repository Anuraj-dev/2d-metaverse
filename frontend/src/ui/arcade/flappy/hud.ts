/**
 * In-canvas HUD: the big arcade score and the ready screen. The run's
 * game-over panel, leaderboard and restart are the overlay's job (see
 * ArcadeOverlay) — this only draws what belongs inside the world.
 */
import type { FlappyState } from "../../../game/arcade/flappy";
import { outlinedText } from "./util";

export function drawScore(ctx: CanvasRenderingContext2D, state: FlappyState): void {
  if (state.phase === "ready") return;
  const size = Math.min(76, state.height * 0.11);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  outlinedText(ctx, String(state.score), state.width * 0.5, state.height * 0.14, size);
  ctx.restore();
}

export function drawReadyScreen(ctx: CanvasRenderingContext2D, state: FlappyState): void {
  const cx = state.width * 0.5;
  const titleSize = Math.min(92, state.width * 0.15);
  const titleY = state.groundY * 0.2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  outlinedText(ctx, "FLAPPY", cx, titleY, titleSize, "#ffe14d");
  outlinedText(ctx, "BIRD", cx, titleY + titleSize * 0.92, titleSize);
  ctx.restore();

  // Pulsing call to action.
  const promptSize = Math.min(40, state.width * 0.062);
  const pulse = 0.72 + Math.sin(state.time * 3.4) * 0.28;
  ctx.save();
  ctx.globalAlpha = pulse;
  outlinedText(ctx, "TAP  TO  START", cx, state.groundY * 0.74, promptSize);
  ctx.restore();

  // The controls line and the pointing hand are deliberately absent: the
  // overlay's scoreline already spells out the controls, so the world stays
  // clean (Raja, 2026-07-30).
}
