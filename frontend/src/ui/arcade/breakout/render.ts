/**
 * Breakout drawing — presentation only. The reducer owns every rule.
 */
import type { BreakoutState } from "../../../game/arcade/breakout";
import { fadeAlpha, shakeOffset, type JuiceState } from "../../../game/arcade/juice";

const ROW_COLORS = ["#e2564d", "#f2c14e", "#7fd1b9", "#2196f3", "#b082ff", "#9aa5c0"] as const;
const HUD_FONT_WORLD = 11;
const HUD_MIN_CSS_PX = 12;

/**
 * World-space HUD font that paints at least `minCssPx` on the displayed canvas.
 * Desktop courts (client width ≳ 700) keep the 11px design size.
 */
export function breakoutHudFontWorld(
  worldWidth: number,
  clientWidth: number,
  baseWorld = HUD_FONT_WORLD,
  minCssPx = HUD_MIN_CSS_PX
): number {
  if (!(clientWidth > 0) || !(worldWidth > 0)) return baseWorld;
  return Math.max(baseWorld, minCssPx / (clientWidth / worldWidth));
}

export function renderBreakout(
  ctx: CanvasRenderingContext2D,
  state: BreakoutState,
  juice: JuiceState,
  scaleX: number,
  scaleY: number,
  shakeEnabled: boolean
): void {
  const w = state.width;
  const h = state.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.5, 0, 20, w * 0.5, 0, h * 0.8);
  glow.addColorStop(0, "rgba(127, 209, 185, 0.10)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const shake = shakeEnabled ? shakeOffset(juice) : { x: 0, y: 0 };
  ctx.save();
  ctx.translate(shake.x, shake.y);

  ctx.strokeStyle = "rgba(58, 71, 103, 0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  for (const brick of state.bricks) {
    if (brick.hp <= 0) continue;
    const color = ROW_COLORS[brick.row] ?? "#9aa5c0";
    ctx.fillStyle = color;
    ctx.globalAlpha = brick.hp > 1 ? 1 : 0.82;
    roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, brick.x + 2, brick.y + 1, brick.w - 4, 3, 1);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const px = state.paddleX - state.paddleW / 2;
  ctx.fillStyle = "#e8ecf5";
  roundRect(ctx, px, state.paddleY, state.paddleW, state.paddleH, 4);
  ctx.fill();
  ctx.fillStyle = "#7fd1b9";
  ctx.fillRect(px + 8, state.paddleY + 2, state.paddleW - 16, 3);

  ctx.beginPath();
  ctx.arc(state.ballX, state.ballY, state.ballR, 0, Math.PI * 2);
  ctx.fillStyle = "#f2c14e";
  ctx.fill();
  ctx.fillStyle = "#fff4c8";
  ctx.beginPath();
  ctx.arc(state.ballX - 1.4, state.ballY - 1.4, state.ballR * 0.35, 0, Math.PI * 2);
  ctx.fill();

  for (const p of juice.particles) {
    ctx.globalAlpha = fadeAlpha(p.life, p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const hudFont = breakoutHudFontWorld(w, ctx.canvas.clientWidth);
  const hudK = hudFont / HUD_FONT_WORLD;
  ctx.font = `700 ${12 * hudK}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (const u of juice.popups) {
    ctx.globalAlpha = fadeAlpha(u.life, u.maxLife);
    ctx.fillStyle = u.color;
    ctx.fillText(u.text, u.x, u.y);
  }
  ctx.globalAlpha = 1;

  // HUD in uniform X-scale so a portrait Y-stretch does not squash glyphs.
  const yAdj = scaleX === 0 ? 1 : scaleY / scaleX;
  ctx.setTransform(scaleX, 0, 0, scaleX, 0, 0);
  ctx.fillStyle = "#9aa5c0";
  ctx.font = `700 ${hudFont}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`Lv ${state.level}`, 16, 24 * yAdj);
  for (let i = 0; i < state.lives; i += 1) {
    ctx.beginPath();
    ctx.arc(w - 20 - i * 14 * hudK, 20 * yAdj, 4.5 * hudK, 0, Math.PI * 2);
    ctx.fillStyle = "#e2564d";
    ctx.fill();
  }

  if (state.phase === "ready") {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(11, 16, 32, 0.45)";
    ctx.fillRect(0, h * 0.52 * yAdj, w, 64 * hudK);
    ctx.fillStyle = "#e8ecf5";
    ctx.font = `800 ${28 * hudK}px system-ui, sans-serif`;
    ctx.fillText("BREAKOUT", w / 2, h * 0.58 * yAdj);
    ctx.fillStyle = "#7fd1b9";
    ctx.font = `600 ${13 * hudK}px system-ui, sans-serif`;
    ctx.fillText("Click or Space to serve  ·  A/D or mouse to aim", w / 2, h * 0.58 * yAdj + 22 * hudK);
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
