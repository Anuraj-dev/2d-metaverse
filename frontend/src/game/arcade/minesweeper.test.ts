import { describe, expect, it } from "vitest";
import {
  MINES_CELL_COUNT,
  MINES_COLS,
  MINES_COUNT,
  REVEAL_POINTS,
  WIN_BONUS,
  initMinesweeper,
  minesChord,
  minesFlag,
  minesMoveCursor,
  minesNeighbors,
  minesRemaining,
  minesReveal,
  minesRevealedSafe,
  minesTick,
  type MinesState,
} from "./minesweeper";

function revealAllSafe(seed: number, start: number): MinesState {
  let s = minesReveal(initMinesweeper(seed), start).state;
  for (let guard = 0; guard < MINES_CELL_COUNT && s.phase === "play"; guard += 1) {
    const hidden = s.cells.findIndex((c) => !c.mine && c.mark === "hidden");
    if (hidden < 0) break;
    s = minesReveal(s, hidden).state;
  }
  return s;
}

describe("initMinesweeper", () => {
  it("starts ready with a covered board and no mines placed", () => {
    const s = initMinesweeper(1);
    expect(s.phase).toBe("ready");
    expect(s.placed).toBe(false);
    expect(s.cells).toHaveLength(MINES_CELL_COUNT);
    expect(s.cells.every((c) => c.mark === "hidden" && !c.mine)).toBe(true);
    expect(s.score).toBe(0);
    expect(minesRemaining(s)).toBe(MINES_COUNT);
  });
});

describe("minesReveal", () => {
  it("places mines after the first click and never mines the opening", () => {
    const step = minesReveal(initMinesweeper(9), 0);
    expect(step.state.placed).toBe(true);
    expect(step.state.phase).toBe("play");
    expect(step.events).toContain("reveal");
    const opening = new Set([0, ...minesNeighbors(0, MINES_COLS, step.state.rows)]);
    for (const i of opening) {
      const cell = step.state.cells[i];
      expect(cell?.mine, `opening cell ${i} is safe`).toBe(false);
    }
    expect(step.state.cells.filter((c) => c.mine)).toHaveLength(MINES_COUNT);
  });

  it("floods zeroes so a corner opening reveals more than one cell", () => {
    const s = minesReveal(initMinesweeper(1), 0).state;
    expect(minesRevealedSafe(s)).toBeGreaterThan(1);
    const origin = s.cells[0];
    expect(origin?.mark).toBe("revealed");
    expect(origin?.mine).toBe(false);
  });

  it("ignores a flagged cell", () => {
    const opened = minesReveal(initMinesweeper(2), 0).state;
    const hidden = opened.cells.findIndex((c) => c.mark === "hidden");
    expect(hidden).toBeGreaterThanOrEqual(0);
    const flagged = minesFlag(opened, hidden).state;
    const again = minesReveal(flagged, hidden);
    expect(again.state.cells[hidden]?.mark).toBe("flag");
    expect(again.events).toEqual([]);
  });

  it("does not place mines or start the clock when the first click is a flag", () => {
    const flagged = minesFlag(initMinesweeper(1), 0).state;
    const step = minesReveal(flagged, 0);
    expect(step.events).toEqual([]);
    expect(step.state.placed).toBe(false);
    expect(step.state.phase).toBe("ready");
    expect(step.state.elapsedMs).toBe(0);
    expect(step.state.cells[0]?.mark).toBe("flag");
    expect(step.state.rngSeed).toBe(flagged.rngSeed);
    const opened = minesReveal(step.state, 1);
    expect(opened.state.placed).toBe(true);
    expect(opened.events).toContain("reveal");
  });

  it("ignores a second click on an already-open cell", () => {
    const opened = minesReveal(initMinesweeper(2), 0).state;
    const noop = minesReveal(opened, 0);
    expect(noop.events).toEqual([]);
    expect(noop.state.cells[0]?.mark).toBe("revealed");
  });

  it("loses when a mine is revealed after placement", () => {
    const opened = minesReveal(initMinesweeper(4), 0).state;
    const mine = opened.cells.findIndex((c) => c.mine && c.mark === "hidden");
    expect(mine).toBeGreaterThanOrEqual(0);
    const step = minesReveal(opened, mine);
    expect(step.events).toContain("boom");
    expect(step.state.phase).toBe("lost");
    expect(step.state.boomIndex).toBe(mine);
    expect(step.state.cells[mine]?.mark).toBe("revealed");
  });

  it("wins once every safe cell is open and auto-flags remaining mines", () => {
    const s = revealAllSafe(11, 0);
    expect(s.phase).toBe("won");
    expect(s.cells.filter((c) => c.mine && c.mark === "flag")).toHaveLength(MINES_COUNT);
    expect(s.score).toBeGreaterThanOrEqual(WIN_BONUS + minesRevealedSafe(s) * REVEAL_POINTS);
  });
});

describe("minesFlag / cursor / tick", () => {
  it("toggles a flag and updates remaining mines", () => {
    const s = initMinesweeper(1);
    const flagged = minesFlag(s, 5);
    expect(flagged.events).toEqual(["flag"]);
    expect(flagged.state.cells[5]?.mark).toBe("flag");
    expect(minesRemaining(flagged.state)).toBe(MINES_COUNT - 1);
    const cleared = minesFlag(flagged.state, 5);
    expect(cleared.events).toEqual(["unflag"]);
    expect(cleared.state.cells[5]?.mark).toBe("hidden");
  });

  it("moves the keyboard cursor and stops at the edges", () => {
    const s = initMinesweeper(1);
    expect(minesMoveCursor(s, "left")).toBe(s);
    expect(minesMoveCursor(s, "up")).toBe(s);
    const right = minesMoveCursor(s, "right");
    expect(right.cursor).toBe(1);
    const down = minesMoveCursor(s, "down");
    expect(down.cursor).toBe(MINES_COLS);
  });

  it("advances elapsed time only while playing", () => {
    const ready = minesTick(initMinesweeper(1), 1000);
    expect(ready.elapsedMs).toBe(0);
    const playing = minesReveal(initMinesweeper(1), 0).state;
    const ticked = minesTick(playing, 1500);
    expect(ticked.elapsedMs).toBe(1500);
    const lost = minesReveal(playing, playing.cells.findIndex((c) => c.mine)).state;
    expect(minesTick(lost, 4000).elapsedMs).toBe(lost.elapsedMs);
  });
});

describe("minesChord", () => {
  it("opens remaining neighbours when the flags match the number", () => {
    const blank = initMinesweeper(1);
    const cells = blank.cells.map((cell, i) => {
      if (i === 12) return { mine: true, adjacent: 0, mark: "flag" as const };
      if (i === 11) return { mine: false, adjacent: 1, mark: "revealed" as const };
      if (i === 0 || i === 1 || i === 2 || i === 10 || i === 20 || i === 21 || i === 22) {
        return { mine: false, adjacent: 1, mark: "hidden" as const };
      }
      return cell;
    });
    const s: MinesState = {
      ...blank,
      cells,
      placed: true,
      phase: "play",
      cursor: 11,
    };
    const step = minesChord(s, 11);
    expect(step.events).toContain("chord");
    expect(step.state.cells[12]?.mark).toBe("flag");
    expect(step.state.cells[10]?.mark).toBe("revealed");
    expect(step.state.cells[21]?.mark).toBe("revealed");
  });

  it("is ignored on hidden cells and when flags do not match", () => {
    const opened = minesReveal(initMinesweeper(8), 0).state;
    const hidden = opened.cells.findIndex((c) => c.mark === "hidden");
    expect(minesChord(opened, hidden).events).toEqual([]);
    const numbered = opened.cells.findIndex((c) => c.mark === "revealed" && c.adjacent > 0);
    expect(minesChord(opened, numbered).events).toEqual([]);
  });
});

describe("determinism", () => {
  function run(seed: number): MinesState {
    let s = initMinesweeper(seed);
    const script = [0, 3, 12, 25, 40, 55, 70, 88, 99];
    for (const i of script) {
      if (s.phase !== "ready" && s.phase !== "play") break;
      if (i % 2 === 0) s = minesFlag(s, (i + 7) % MINES_CELL_COUNT).state;
      s = minesReveal(s, i).state;
      s = minesTick(s, 16);
    }
    return s;
  }

  it("same seed + click script ⇒ identical outcome", () => {
    expect(run(555)).toEqual(run(555));
  });

  it("different seeds diverge", () => {
    expect(run(555).cells.map((c) => (c.mine ? 1 : 0)).join("")).not.toBe(
      run(777).cells.map((c) => (c.mine ? 1 : 0)).join("")
    );
  });
});
