import { describe, expect, it } from "vitest";
import {
  CELL_CSS,
  EDGE_INSET,
  MIN_COLS,
  MIN_ROWS,
  boardForStage,
} from "./stage";

describe("boardForStage", () => {
  it("returns null when the stage has no box yet", () => {
    expect(boardForStage(0, 0)).toBeNull();
    expect(boardForStage(2, 400)).toBeNull();
  });

  it("floors to whole 20px cells and never scales the cell size", () => {
    const wide = 34 * CELL_CSS + 2 * EDGE_INSET + 19;
    const tall = 18 * CELL_CSS + 2 * EDGE_INSET + 19;
    expect(boardForStage(wide, tall)).toEqual({ cols: 34, rows: 18 });
  });

  it("grows the board when the stage is larger, still at 20px cells", () => {
    const wide = 52 * CELL_CSS + 2 * EDGE_INSET;
    const tall = 30 * CELL_CSS + 2 * EDGE_INSET;
    expect(boardForStage(wide, tall)).toEqual({ cols: 52, rows: 30 });
  });

  it("does not drop below the playable minimum", () => {
    expect(boardForStage(MIN_COLS * CELL_CSS, MIN_ROWS * CELL_CSS)).toEqual({
      cols: MIN_COLS,
      rows: MIN_ROWS,
    });
  });
});
