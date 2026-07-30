/**
 * Composes one Flappy frame: backdrop → pipes → puffs → bird → ground →
 * vignette, then the HUD and the hit flash on top. Draw-only; it never mutates
 * game state.
 */
import type { FlappyState } from "../../../game/arcade/flappy";
import { drawBackground, drawGround, type Cloud } from "./scenery";
import { drawPipes } from "./pipes";
import { drawBird } from "./bird";
import { drawPuffs, type FlappyFx } from "./fx";
import { drawScore, drawReadyScreen } from "./hud";
import { hash } from "./util";

export function renderFlappy(
  ctx: CanvasRenderingContext2D,
  state: FlappyState,
  fx: FlappyFx,
  clouds: readonly Cloud[],
  scale: number
): void {
  const { width, height } = state;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Base wash so a shake offset never exposes the previous frame at the edges.
  ctx.fillStyle = "#67c3d6";
  ctx.fillRect(0, 0, width, height);

  let shakeX = 0;
  let shakeY = 0;
  if (fx.shake > 0.2) {
    shakeX = (hash(state.time * 997) - 0.5) * fx.shake;
    shakeY = (hash(state.time * 613 + 7) - 0.5) * fx.shake;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawBackground(ctx, state, clouds);
  drawPipes(ctx, state);
  drawPuffs(ctx, fx);
  drawBird(ctx, state, fx.wing);
  drawGround(ctx, state);

  // Vignette for depth.
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.35,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.26)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  drawScore(ctx, state);
  if (state.phase === "ready") drawReadyScreen(ctx, state);

  if (fx.flash > 0.001) {
    ctx.fillStyle = `rgba(255,255,255,${fx.flash * 0.55})`;
    ctx.fillRect(0, 0, width, height);
  }
}
