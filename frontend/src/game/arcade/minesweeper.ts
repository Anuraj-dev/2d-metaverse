/**
 * Minesweeper — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. Mine placement
 * is drawn from `rngSeed` on the first reveal (the clicked cell and its
 * neighbours are kept clear so the opening is always safe), so a seed + click
 * script reproduces a run (see minesweeper.test.ts).
 *
 * The board is a flat row-major array. A move is a cell index. The timer is
 * advanced by `minesTick` using an explicit `dt` so pausing the overlay freezes
 * elapsed time. Scoring is higher-is-better: 10 points per safe reveal, a win
 * bonus, and leftover time.
 */
import { nextInt } from "./prng";

export type MinesMark = "hidden" | "flag" | "revealed";
export type MinesPhase = "ready" | "play" | "won" | "lost";

export type MinesEvent = "reveal" | "flag" | "unflag" | "chord" | "boom" | "win";

export interface MinesCell {
  readonly mine: boolean;
  readonly adjacent: number;
  readonly mark: MinesMark;
}

export interface MinesState {
  readonly cols: number;
  readonly rows: number;
  readonly mineCount: number;
  readonly cells: readonly MinesCell[];
  readonly placed: boolean;
  readonly phase: MinesPhase;
  readonly cursor: number;
  readonly elapsedMs: number;
  readonly score: number;
  readonly boomIndex: number | null;
  readonly rngSeed: number;
}

export interface MinesStep {
  readonly state: MinesState;
  readonly events: readonly MinesEvent[];
}

export const MINES_COLS = 10;
export const MINES_ROWS = 10;
export const MINES_COUNT = 12;
export const MINES_CELL_COUNT = MINES_COLS * MINES_ROWS;
export const REVEAL_POINTS = 10;
export const WIN_BONUS = 1500;
export const TIME_BUDGET_SEC = 240;
export const TIME_POINTS_PER_SEC = 5;

const EMPTY: MinesCell = { mine: false, adjacent: 0, mark: "hidden" };

function clampIndex(index: number, count: number): number {
  if (!Number.isInteger(index) || count <= 0) return 0;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export function minesIndex(col: number, row: number, cols: number = MINES_COLS): number {
  return row * cols + col;
}

export function minesCoord(
  index: number,
  cols: number = MINES_COLS
): { col: number; row: number } {
  return { col: index % cols, row: Math.floor(index / cols) };
}

/** Neighbours in a stable scan order (top-left → bottom-right). */
export function minesNeighbors(
  index: number,
  cols: number = MINES_COLS,
  rows: number = MINES_ROWS
): number[] {
  const { col, row } = minesCoord(index, cols);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      out.push(minesIndex(c, r, cols));
    }
  }
  return out;
}

export function minesRemaining(state: MinesState): number {
  let flags = 0;
  for (const cell of state.cells) {
    if (cell.mark === "flag") flags += 1;
  }
  return state.mineCount - flags;
}

export function minesRevealedSafe(state: MinesState): number {
  let n = 0;
  for (const cell of state.cells) {
    if (cell.mark === "revealed" && !cell.mine) n += 1;
  }
  return n;
}

function scoreFor(state: Pick<MinesState, "cells" | "elapsedMs" | "phase">): number {
  let revealed = 0;
  for (const cell of state.cells) {
    if (cell.mark === "revealed" && !cell.mine) revealed += 1;
  }
  const base = revealed * REVEAL_POINTS;
  if (state.phase !== "won") return base;
  const elapsedSec = Math.floor(state.elapsedMs / 1000);
  const timePts = Math.max(0, TIME_BUDGET_SEC - elapsedSec) * TIME_POINTS_PER_SEC;
  return base + WIN_BONUS + timePts;
}

function blankBoard(count: number): MinesCell[] {
  return Array.from({ length: count }, () => EMPTY);
}

export function initMinesweeper(seed: number): MinesState {
  const cells = blankBoard(MINES_CELL_COUNT);
  return {
    cols: MINES_COLS,
    rows: MINES_ROWS,
    mineCount: MINES_COUNT,
    cells,
    placed: false,
    phase: "ready",
    cursor: 0,
    elapsedMs: 0,
    score: 0,
    boomIndex: null,
    rngSeed: seed >>> 0 || 1,
  };
}

function forbiddenSet(start: number, cols: number, rows: number): Set<number> {
  const set = new Set<number>([start]);
  for (const n of minesNeighbors(start, cols, rows)) set.add(n);
  return set;
}

function placeMines(state: MinesState, start: number): MinesState {
  const forbidden = forbiddenSet(start, state.cols, state.rows);
  const pool: number[] = [];
  for (let i = 0; i < state.cells.length; i += 1) {
    if (!forbidden.has(i)) pool.push(i);
  }
  let seed = state.rngSeed;
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const draw = nextInt(seed, i + 1);
    seed = draw.seed;
    const j = draw.value;
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) continue;
    pool[i] = b;
    pool[j] = a;
  }
  const mineAt = new Set(pool.slice(0, state.mineCount));
  const cells: MinesCell[] = state.cells.map((cell, i) => ({
    mine: mineAt.has(i),
    adjacent: 0,
    mark: cell.mark,
  }));
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!cell || cell.mine) continue;
    let adj = 0;
    for (const n of minesNeighbors(i, state.cols, state.rows)) {
      if (mineAt.has(n)) adj += 1;
    }
    cells[i] = { ...cell, adjacent: adj };
  }
  return { ...state, cells, placed: true, rngSeed: seed, phase: "play" };
}

function floodReveal(cells: readonly MinesCell[], start: number, cols: number, rows: number): MinesCell[] {
  const next = cells.slice();
  const stack = [start];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const i = stack.pop();
    if (i === undefined || seen.has(i)) continue;
    seen.add(i);
    const cell = next[i];
    if (!cell || cell.mark === "flag" || cell.mine) continue;
    next[i] = { ...cell, mark: "revealed" };
    if (cell.adjacent !== 0) continue;
    const neigh = minesNeighbors(i, cols, rows);
    for (let k = neigh.length - 1; k >= 0; k -= 1) {
      const n = neigh[k];
      if (n === undefined) continue;
      const nc = next[n];
      if (nc && nc.mark === "hidden") stack.push(n);
    }
  }
  return next;
}

function allSafeRevealed(cells: readonly MinesCell[]): boolean {
  for (const cell of cells) {
    if (!cell.mine && cell.mark !== "revealed") return false;
  }
  return true;
}

function finishWin(state: MinesState, cells: readonly MinesCell[]): MinesState {
  const flagged = cells.map((cell) =>
    cell.mine && cell.mark !== "revealed" ? { ...cell, mark: "flag" as const } : cell
  );
  const next: MinesState = {
    ...state,
    cells: flagged,
    phase: "won",
    score: 0,
    boomIndex: null,
  };
  return { ...next, score: scoreFor(next) };
}

function finishLoss(state: MinesState, cells: readonly MinesCell[], boomIndex: number): MinesState {
  const exposed = cells.map((cell, i) => {
    if (cell.mine) return { ...cell, mark: "revealed" as const };
    if (cell.mark === "flag") return cell;
    return i === boomIndex ? { ...cell, mark: "revealed" as const } : cell;
  });
  const next: MinesState = {
    ...state,
    cells: exposed,
    phase: "lost",
    boomIndex,
    score: 0,
  };
  return { ...next, score: scoreFor(next) };
}

function live(state: MinesState): boolean {
  return state.phase === "ready" || state.phase === "play";
}

export function minesMoveCursor(state: MinesState, dir: "up" | "down" | "left" | "right"): MinesState {
  if (!live(state)) return state;
  const { col, row } = minesCoord(state.cursor, state.cols);
  let c = col;
  let r = row;
  if (dir === "left") c -= 1;
  else if (dir === "right") c += 1;
  else if (dir === "up") r -= 1;
  else r += 1;
  if (c < 0 || c >= state.cols || r < 0 || r >= state.rows) return state;
  return { ...state, cursor: minesIndex(c, r, state.cols) };
}

export function minesFlag(state: MinesState, index: number): MinesStep {
  if (!live(state)) return { state, events: [] };
  const i = clampIndex(index, state.cells.length);
  const cell = state.cells[i];
  if (!cell || cell.mark === "revealed") return { state, events: [] };
  const cells = state.cells.slice();
  const flagged = cell.mark !== "flag";
  cells[i] = { ...cell, mark: flagged ? "flag" : "hidden" };
  const next: MinesState = { ...state, cells, cursor: i, score: scoreFor({ ...state, cells }) };
  return { state: next, events: [flagged ? "flag" : "unflag"] };
}

export function minesReveal(state: MinesState, index: number): MinesStep {
  if (!live(state)) return { state, events: [] };
  const i = clampIndex(index, state.cells.length);
  const cell = state.cells[i];
  // Reject flagged/revealed cells BEFORE placing mines. A first-click on a
  // flag must not consume the safe opening or start the clock.
  if (!cell || cell.mark === "flag" || cell.mark === "revealed") {
    return { state, events: [] };
  }
  let current = { ...state, cursor: i };
  if (!current.placed) current = placeMines(current, i);
  const placed = current.cells[i];
  if (!placed) return { state: current, events: [] };
  if (placed.mine) {
    const lost = finishLoss(current, current.cells, i);
    return { state: lost, events: ["boom"] };
  }
  const cells = floodReveal(current.cells, i, current.cols, current.rows);
  if (allSafeRevealed(cells)) {
    const won = finishWin(current, cells);
    return { state: won, events: ["reveal", "win"] };
  }
  const next: MinesState = {
    ...current,
    cells,
    phase: "play",
    score: scoreFor({ ...current, cells, phase: "play" }),
  };
  return { state: next, events: ["reveal"] };
}

/**
 * Chord: on a revealed numbered cell whose neighbouring flags equal its
 * adjacent count, reveal every remaining hidden neighbour. A misplaced flag
 * detonates.
 */
export function minesChord(state: MinesState, index: number): MinesStep {
  if (state.phase !== "play") return { state, events: [] };
  const i = clampIndex(index, state.cells.length);
  const cell = state.cells[i];
  if (!cell || cell.mark !== "revealed" || cell.adjacent <= 0) {
    return { state, events: [] };
  }
  const neigh = minesNeighbors(i, state.cols, state.rows);
  let flags = 0;
  for (const n of neigh) {
    const nc = state.cells[n];
    if (nc?.mark === "flag") flags += 1;
  }
  if (flags !== cell.adjacent) return { state, events: [] };

  let current = { ...state, cursor: i };
  const events: MinesEvent[] = ["chord"];
  for (const n of neigh) {
    const nc = current.cells[n];
    if (!nc || nc.mark !== "hidden") continue;
    const step = minesReveal(current, n);
    current = step.state;
    for (const ev of step.events) {
      if (ev !== "reveal") events.push(ev);
    }
    if (current.phase === "lost" || current.phase === "won") break;
  }
  return { state: current, events };
}

/** Advance the play clock. Frozen once the board is won or lost. */
export function minesTick(state: MinesState, dtMs: number): MinesState {
  if (state.phase !== "play") return state;
  return { ...state, elapsedMs: state.elapsedMs + Math.max(0, dtMs) };
}
