/**
 * Rounded snake segments with direction-facing eyes on the head.
 * All dimensions derive from the host-computed `cell` (device px).
 */
import type { Cell, Dir } from "../../../game/arcade/snake";
import { SNAKE_COLORS, eyeOffsets, roundedRect } from "./util";

export function drawSnake(
  ctx: CanvasRenderingContext2D,
  body: readonly Cell[],
  dir: Dir,
  cell: number,
  alpha = 1
): void {
  if (body.length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < body.length; i++) {
    const segment = body[i];
    if (!segment) continue;
    const isHead = i === 0;
    const fill = isHead
      ? SNAKE_COLORS.head
      : i % 2 === 0
        ? SNAKE_COLORS.body
        : SNAKE_COLORS.bodyAlt;
    drawSegment(ctx, segment, isHead, dir, fill, cell);
  }
  ctx.restore();
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  segment: Cell,
  isHead: boolean,
  dir: Dir,
  fillColor: string,
  cell: number
): void {
  const gap = Math.max(1, cell * 0.05);
  const x = segment.x * cell;
  const y = segment.y * cell;
  const size = cell - gap;
  const radius = cell / 3;

  ctx.fillStyle = fillColor;
  roundedRect(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.strokeStyle = SNAKE_COLORS.outline;
  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.stroke();

  if (!isHead) return;

  const eyeSize = cell / 5;
  for (const [ex, ey] of eyeOffsets(dir)) {
    const cx = x + ex * cell;
    const cy = y + ey * cell;
    ctx.fillStyle = SNAKE_COLORS.eye;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SNAKE_COLORS.pupil;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
