/**
 * Snake stage geometry. The playfield fills the cabinet with more cells at a
 * FIXED 20 CSS-px size. Cells are never scaled up to fit; that reads as zoom.
 */

/** Original game cell size in CSS pixels. Never scaled up to fill the stage. */
export const CELL_CSS = 20;
/** Smallest playable board if the stage is tiny. */
export const MIN_COLS = 20;
export const MIN_ROWS = 12;
/**
 * Minimum letterbox per side. The stage surface clips with a 10px border
 * radius; anything closer than ~3px to its edge gets a bite taken out of the
 * corner cells, which players read as "the end cell is cut off".
 */
export const EDGE_INSET = 4;

/** Board size in whole cells for the current stage box. */
export interface SnakeBoard {
  readonly cols: number;
  readonly rows: number;
}

/**
 * How many whole FIXED-size cells fit in the stage. Returns null when the
 * box has not been measured yet (jsdom / hidden).
 */
export function boardForStage(
  clientWidth: number,
  clientHeight: number,
): SnakeBoard | null {
  const boxW = clientWidth - 2 * EDGE_INSET;
  const boxH = clientHeight - 2 * EDGE_INSET;
  if (boxW < 1 || boxH < 1) return null;
  return {
    cols: Math.max(MIN_COLS, Math.floor(boxW / CELL_CSS)),
    rows: Math.max(MIN_ROWS, Math.floor(boxH / CELL_CSS)),
  };
}
