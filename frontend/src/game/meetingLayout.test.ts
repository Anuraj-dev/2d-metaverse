import { describe, it, expect } from "vitest";
import {
  arrangeMeeting,
  fitCells,
  gridDimensions,
  resolveFocusKey,
  TILE_ASPECT,
  type MeetingTile,
} from "./meetingLayout";

/** Build a camera tile with the given id/order. */
function cam(id: string, order: number, extra: Partial<MeetingTile> = {}): MeetingTile {
  return { key: `${id}:camera`, participantId: id, source: "camera", self: false, hasVideo: false, order, ...extra };
}
/** Build a screen-share tile with the given id/order. */
function screen(id: string, order: number): MeetingTile {
  return { key: `${id}:screen`, participantId: id, source: "screen", self: false, hasVideo: true, order };
}

describe("gridDimensions", () => {
  it.each([
    [1, { rows: 1, columns: 1 }],
    [2, { rows: 1, columns: 2 }],
    [3, { rows: 2, columns: 2 }],
    [4, { rows: 2, columns: 2 }],
    [5, { rows: 2, columns: 3 }],
    [6, { rows: 2, columns: 3 }],
    [9, { rows: 3, columns: 3 }],
    [10, { rows: 3, columns: 4 }],
  ])("reflows %i tiles to a near-square", (n, dims) => {
    expect(gridDimensions(n)).toEqual(dims);
  });

  it("is empty for zero", () => {
    expect(gridDimensions(0)).toEqual({ rows: 0, columns: 0 });
  });
});

describe("resolveFocusKey", () => {
  it("returns null with no shares and no manual focus (symmetric grid)", () => {
    expect(resolveFocusKey({ tiles: [cam("a", 0), cam("b", 1)], manualFocusKey: null })).toBeNull();
  });

  it("focuses an active screen share automatically", () => {
    expect(
      resolveFocusKey({ tiles: [cam("a", 0), screen("b", 5)], manualFocusKey: null }),
    ).toBe("b:screen");
  });

  it("focuses the most-recent of two simultaneous shares", () => {
    const tiles = [screen("a", 3), screen("b", 7), cam("c", 1)];
    expect(resolveFocusKey({ tiles, manualFocusKey: null })).toBe("b:screen");
  });

  it("lets a manual focus override an active share", () => {
    const tiles = [cam("a", 0), screen("b", 5)];
    expect(resolveFocusKey({ tiles, manualFocusKey: "a:camera" })).toBe("a:camera");
  });

  it("ignores a manual focus whose tile has left", () => {
    const tiles = [cam("a", 0), screen("b", 5)];
    expect(resolveFocusKey({ tiles, manualFocusKey: "gone:camera" })).toBe("b:screen");
  });
});

describe("arrangeMeeting", () => {
  it("arranges a symmetric grid in stable arrival order", () => {
    const a = arrangeMeeting({ tiles: [cam("b", 2), cam("a", 1), cam("c", 3)], manualFocusKey: null });
    expect(a.mode).toBe("grid");
    expect(a.focusKey).toBeNull();
    expect(a.grid).toEqual(["a:camera", "b:camera", "c:camera"]);
    expect(a.dims).toEqual({ rows: 2, columns: 2 });
  });

  it("puts a share in focus and everyone else in the filmstrip", () => {
    const a = arrangeMeeting({
      tiles: [cam("a", 1), cam("b", 2), screen("c", 5)],
      manualFocusKey: null,
    });
    expect(a.mode).toBe("focus");
    expect(a.focusKey).toBe("c:screen");
    expect(a.filmstrip).toEqual(["a:camera", "b:camera"]);
    expect(a.grid).toEqual([]);
    expect(a.dims).toEqual({ rows: 1, columns: 2 });
  });

  it("transitions grid → focus when a share arrives", () => {
    const before = arrangeMeeting({ tiles: [cam("a", 0), cam("b", 1)], manualFocusKey: null });
    expect(before.mode).toBe("grid");
    const after = arrangeMeeting({ tiles: [cam("a", 0), cam("b", 1), screen("a", 2)], manualFocusKey: null });
    expect(after.mode).toBe("focus");
    expect(after.focusKey).toBe("a:screen");
  });

  it("transitions focus → grid when the share ends", () => {
    const during = arrangeMeeting({ tiles: [cam("a", 0), screen("a", 2)], manualFocusKey: null });
    expect(during.mode).toBe("focus");
    const after = arrangeMeeting({ tiles: [cam("a", 0)], manualFocusKey: null });
    expect(after.mode).toBe("grid");
    expect(after.filmstrip).toEqual([]);
  });

  it("focus mode with a single participant has an empty filmstrip", () => {
    const a = arrangeMeeting({ tiles: [screen("a", 1)], manualFocusKey: "a:screen" });
    expect(a.mode).toBe("focus");
    expect(a.filmstrip).toEqual([]);
    expect(a.dims).toEqual({ rows: 1, columns: 1 });
  });
});

describe("fitCells", () => {
  it("preserves aspect ratio, constrained by width", () => {
    // Wide container, single cell: width binds, height = width / aspect.
    const cell = fitCells({ width: 320, height: 400 }, { rows: 1, columns: 1 }, TILE_ASPECT, 0);
    expect(cell.width).toBe(320);
    expect(cell.height).toBe(Math.floor(320 / TILE_ASPECT));
  });

  it("preserves aspect ratio, constrained by height", () => {
    // Tall container: height binds, width = height * aspect.
    const cell = fitCells({ width: 1000, height: 90 }, { rows: 1, columns: 1 }, TILE_ASPECT, 0);
    expect(cell.height).toBe(90);
    expect(cell.width).toBe(Math.floor(90 * TILE_ASPECT));
  });

  it("accounts for columns, rows and gaps", () => {
    const cell = fitCells({ width: 640, height: 1000 }, { rows: 1, columns: 2 }, TILE_ASPECT, 20);
    // availW = (640 - 20) / 2 = 310; height = 310 / aspect fits.
    expect(cell.width).toBe(310);
    expect(cell.height).toBe(Math.floor(310 / TILE_ASPECT));
  });

  it("returns zero when nothing fits", () => {
    expect(fitCells({ width: 10, height: 10 }, { rows: 0, columns: 0 })).toEqual({ width: 0, height: 0 });
    expect(fitCells({ width: 0, height: 0 }, { rows: 2, columns: 2 })).toEqual({ width: 0, height: 0 });
  });
});
