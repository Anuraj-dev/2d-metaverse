/**
 * Flappy pipe art: shaded green columns with lipped caps, seams and a soft
 * drop shadow. Geometry comes straight from the pure module's `pipes`.
 */
import type { FlappyState } from "../../../game/arcade/flappy";
import { roundedRect } from "./util";

const CAP_HEIGHT = 34;
const CAP_OVERHANG = 9;

function bodyGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number
): CanvasGradient {
  const g = ctx.createLinearGradient(x, 0, x + width, 0);
  g.addColorStop(0.0, "#3e7d2a");
  g.addColorStop(0.08, "#5aa83a");
  g.addColorStop(0.26, "#8fd85c");
  g.addColorStop(0.42, "#c7f090");
  g.addColorStop(0.56, "#7fc94f");
  g.addColorStop(0.82, "#4f9a33");
  g.addColorStop(0.94, "#316a20");
  g.addColorStop(1.0, "#24501a");
  return g;
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (h <= 0) return;
  ctx.fillStyle = bodyGradient(ctx, x, w);
  ctx.fillRect(x, y, w, h);

  // Vertical seams.
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x + w * 0.2, y, 3, h);
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(x + w * 0.7, y, 2, h);

  ctx.strokeStyle = "rgba(28,60,18,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y, w - 2, h);
}

function drawCap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const capW = w + CAP_OVERHANG * 2;
  const capX = x - CAP_OVERHANG;
  ctx.fillStyle = bodyGradient(ctx, capX, capW);
  roundedRect(ctx, capX, y, capW, CAP_HEIGHT, 5);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(capX + 2, y + 3, capW - 4, 4);
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.fillRect(capX + 2, y + CAP_HEIGHT - 7, capW - 4, 5);

  ctx.strokeStyle = "rgba(28,60,18,0.95)";
  ctx.lineWidth = 2.5;
  roundedRect(ctx, capX + 1, y + 1, capW - 2, CAP_HEIGHT - 2, 5);
  ctx.stroke();
}

export function drawPipes(ctx: CanvasRenderingContext2D, state: FlappyState): void {
  const w = state.pipeWidth;
  for (const pipe of state.pipes) {
    if (pipe.x > state.width + 40 || pipe.x + w < -40) continue;
    const bottom = pipe.top + pipe.gap;

    // Soft shadow cast behind the column.
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(pipe.x + 6, 0, w, pipe.top);
    ctx.fillRect(pipe.x + 6, bottom, w, state.groundY - bottom + 6);

    drawSegment(ctx, pipe.x, -10, w, pipe.top - CAP_HEIGHT + 10);
    drawCap(ctx, pipe.x, pipe.top - CAP_HEIGHT, w);

    drawCap(ctx, pipe.x, bottom, w);
    drawSegment(ctx, pipe.x, bottom + CAP_HEIGHT, w, state.groundY - bottom - CAP_HEIGHT + 10);
  }
}
