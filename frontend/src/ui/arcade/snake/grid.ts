/**
 * White playfield + dotted grid background (original Snake look).
 * `cell` is the host-computed cell size in device pixels — every dimension
 * here is a ratio of it, so the board scales to any stage size.
 */
import { SNAKE_COLORS } from "./util";

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  cell: number
): void {
  const w = cols * cell;
  const h = rows * cell;
  ctx.fillStyle = SNAKE_COLORS.board;
  ctx.fillRect(0, 0, w, h);

  const dotSize = Math.max(0.75, cell * 0.05);
  ctx.fillStyle = SNAKE_COLORS.gridDot;
  for (let x = 0; x <= cols; x++) {
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.arc(x * cell, y * cell, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The board edge kills — draw it. Without a stroke the outermost row/column
  // reads as letterbox (the edge grid dots are half-clipped by the canvas
  // bounds), so players misjudged where the wall is.
  const lw = Math.max(1, Math.round(cell * 0.05));
  ctx.strokeStyle = SNAKE_COLORS.boardEdge;
  ctx.lineWidth = lw;
  ctx.strokeRect(lw / 2, lw / 2, w - lw, h - lw);
}
