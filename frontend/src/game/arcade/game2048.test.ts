import { describe, it, expect } from "vitest";
import {
  init2048,
  move2048,
  collapseLine,
  hasNoMoves,
  cellAt,
  WIN_TILE,
  type Game2048State,
} from "./game2048";

/** Build a 4×4 state from a flat array. */
function board(cells: number[], extra: Partial<Game2048State> = {}): Game2048State {
  return {
    size: 4,
    cells,
    score: 0,
    over: false,
    won: false,
    rngSeed: 1,
    ...extra,
  };
}

describe("collapseLine", () => {
  const cases: Array<{ in: number[]; out: number[]; gained: number }> = [
    { in: [0, 0, 0, 0], out: [0, 0, 0, 0], gained: 0 },
    { in: [2, 0, 0, 2], out: [4, 0, 0, 0], gained: 4 },
    { in: [2, 2, 2, 2], out: [4, 4, 0, 0], gained: 8 },
    { in: [2, 2, 4, 0], out: [4, 4, 0, 0], gained: 4 },
    { in: [4, 4, 2, 2], out: [8, 4, 0, 0], gained: 12 },
    { in: [2, 0, 2, 4], out: [4, 4, 0, 0], gained: 4 },
    // A tile merges at most once: [4,4,8] not [16].
    { in: [4, 4, 8, 0], out: [8, 8, 0, 0], gained: 8 },
    { in: [2, 4, 8, 16], out: [2, 4, 8, 16], gained: 0 },
  ];
  for (const c of cases) {
    it(`${c.in.join(",")} ⇒ ${c.out.join(",")} (+${c.gained})`, () => {
      const r = collapseLine(c.in);
      expect(r.line).toEqual(c.out);
      expect(r.gained).toBe(c.gained);
    });
  }
});

describe("move2048 — direction", () => {
  it("slides left and merges", () => {
    const s = move2048(
      board([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      "left"
    );
    expect(cellAt(s, 0, 0)).toBe(4);
    expect(s.score).toBe(4);
  });

  it("slides right", () => {
    const s = move2048(
      board([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      "right"
    );
    expect(cellAt(s, 0, 3)).toBe(4);
  });

  it("slides up", () => {
    const s = move2048(
      board([2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      "up"
    );
    expect(cellAt(s, 0, 0)).toBe(4);
  });

  it("slides down", () => {
    const s = move2048(
      board([2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      "down"
    );
    expect(cellAt(s, 3, 0)).toBe(4);
  });
});

describe("move2048 — no-move detection", () => {
  it("returns the same reference and spawns nothing on a no-op move", () => {
    // A full board where left changes nothing.
    const full = board([2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 8]);
    const after = move2048(full, "left");
    expect(after).toBe(full);
  });

  it("spawns a tile after a real move", () => {
    const before = board([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const after = move2048(before, "left");
    const count = after.cells.filter((n) => n !== 0).length;
    // One merged tile + one spawned tile = 2 non-empty cells.
    expect(count).toBe(2);
  });
});

describe("game over + win", () => {
  it("hasNoMoves is false when an empty cell exists", () => {
    expect(hasNoMoves([2, 0, 0, 0], 2)).toBe(false);
  });
  it("hasNoMoves is true on a locked full board", () => {
    // 2×2 checkerboard with no equal neighbours.
    expect(hasNoMoves([2, 4, 8, 16], 2)).toBe(true);
  });
  it("marks won when a 2048 tile appears", () => {
    const nearWin = board([
      WIN_TILE / 2, WIN_TILE / 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const s = move2048(nearWin, "left");
    expect(s.won).toBe(true);
  });
});

describe("init2048", () => {
  it("starts with exactly two tiles", () => {
    const s = init2048(123);
    expect(s.cells.filter((n) => n !== 0).length).toBe(2);
    expect(s.over).toBe(false);
  });
});

describe("determinism", () => {
  function run(seed: number): Game2048State {
    let s = init2048(seed);
    const script = ["left", "up", "right", "down", "left", "up"] as const;
    for (const d of script) s = move2048(s, d);
    return s;
  }
  it("same seed + move script ⇒ identical outcome", () => {
    expect(run(2048)).toEqual(run(2048));
  });
  it("different seeds diverge in tile placement", () => {
    expect(init2048(1).cells).not.toEqual(init2048(999999).cells);
  });
});
