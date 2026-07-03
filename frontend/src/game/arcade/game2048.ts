/**
 * 2048 — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. New tiles are
 * placed via the seeded PRNG in `rngSeed`, so a seed + move script reproduces a
 * game exactly (see game2048.test.ts).
 *
 * The board is a `size`×`size` grid stored row-major in `cells` (0 = empty).
 * A move slides + merges every line toward the chosen direction; a tile merges
 * at most once per move (classic 2048 semantics). A move that changes nothing
 * spawns no tile — that "no-move" detection is what stops the board thrashing.
 */
import { nextFloat, nextInt } from "./prng";

export type Move2048 = "up" | "down" | "left" | "right";

export interface Game2048State {
  readonly size: number;
  /** Row-major, length `size*size`; 0 = empty. */
  readonly cells: readonly number[];
  readonly score: number;
  readonly over: boolean;
  readonly won: boolean;
  readonly rngSeed: number;
}

export const DEFAULT_2048_SIZE = 4;
export const WIN_TILE = 2048;

/**
 * Slide + merge a single line toward index 0 (i.e. "left").
 * Returns the new line (same length, padded with zeros) and the score gained.
 */
export function collapseLine(line: readonly number[]): {
  line: number[];
  gained: number;
} {
  const tiles = line.filter((n) => n !== 0);
  const result: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    const current = tiles[i] ?? 0;
    const next = tiles[i + 1];
    if (next !== undefined && current === next) {
      const merged = current * 2;
      result.push(merged);
      gained += merged;
      i++; // consume the partner; it cannot merge again this move
    } else {
      result.push(current);
    }
  }
  while (result.length < line.length) result.push(0);
  return { line: result, gained };
}

function getCell(cells: readonly number[], size: number, r: number, c: number) {
  return cells[r * size + c] ?? 0;
}

/**
 * Extract the `size` lines to collapse for a move, each ordered so that index 0
 * is the destination edge. Returns line arrays plus the (r,c) coordinates each
 * value maps back to, so the collapsed values can be written home.
 */
function lineIndices(size: number, dir: Move2048): number[][] {
  const lines: number[][] = [];
  for (let i = 0; i < size; i++) {
    const idx: number[] = [];
    for (let j = 0; j < size; j++) {
      let r: number;
      let c: number;
      switch (dir) {
        case "left":
          r = i;
          c = j;
          break;
        case "right":
          r = i;
          c = size - 1 - j;
          break;
        case "up":
          r = j;
          c = i;
          break;
        case "down":
          r = size - 1 - j;
          c = i;
          break;
      }
      idx.push(r * size + c);
    }
    lines.push(idx);
  }
  return lines;
}

function spawnTile(
  cells: readonly number[],
  size: number,
  seed: number
): { cells: number[]; rngSeed: number } {
  const empties: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if ((cells[i] ?? 0) === 0) empties.push(i);
  }
  const next = cells.slice();
  if (empties.length === 0) return { cells: next, rngSeed: seed };
  const pick = nextInt(seed, empties.length);
  const target = empties[pick.value] ?? empties[0] ?? 0;
  // 90% chance of a 2, 10% chance of a 4.
  const roll = nextFloat(pick.seed);
  next[target] = roll.value < 0.9 ? 2 : 4;
  return { cells: next, rngSeed: roll.seed };
}

/** Fresh game: an empty board seeded with two tiles. */
export function init2048(seed: number, size = DEFAULT_2048_SIZE): Game2048State {
  const empty = new Array<number>(size * size).fill(0);
  const first = spawnTile(empty, size, seed);
  const second = spawnTile(first.cells, size, first.rngSeed);
  return {
    size,
    cells: second.cells,
    score: 0,
    over: hasNoMoves(second.cells, size),
    won: false,
    rngSeed: second.rngSeed,
  };
}

/** True when no slide in any direction would change the board. */
export function hasNoMoves(cells: readonly number[], size: number): boolean {
  if (cells.some((n) => n === 0)) return false;
  const dirs: Move2048[] = ["left", "right", "up", "down"];
  for (const dir of dirs) {
    const { changed } = applyMove(cells, size, dir);
    if (changed) return false;
  }
  return true;
}

/** Apply a move to raw cells without spawning; report score + whether it changed. */
function applyMove(
  cells: readonly number[],
  size: number,
  dir: Move2048
): { cells: number[]; gained: number; changed: boolean } {
  const next = cells.slice();
  let gained = 0;
  let changed = false;
  for (const idx of lineIndices(size, dir)) {
    const line = idx.map((i) => cells[i] ?? 0);
    const collapsed = collapseLine(line);
    gained += collapsed.gained;
    for (let k = 0; k < idx.length; k++) {
      const target = idx[k];
      if (target === undefined) continue;
      const value = collapsed.line[k] ?? 0;
      if (next[target] !== value) changed = true;
      next[target] = value;
    }
  }
  return { cells: next, gained, changed };
}

/**
 * Slide the board. On a move that changes the board a new tile spawns and the
 * score increases by the merged total; a no-op move returns the state unchanged
 * (and spawns nothing). `over`/`won` are recomputed. A finished game is a no-op.
 */
export function move2048(
  state: Game2048State,
  dir: Move2048
): Game2048State {
  if (state.over) return state;
  const { cells, gained, changed } = applyMove(state.cells, state.size, dir);
  if (!changed) return state;
  const spawned = spawnTile(cells, state.size, state.rngSeed);
  const won = state.won || spawned.cells.some((n) => n >= WIN_TILE);
  return {
    ...state,
    cells: spawned.cells,
    score: state.score + gained,
    rngSeed: spawned.rngSeed,
    won,
    over: hasNoMoves(spawned.cells, state.size),
  };
}

/** Read a cell (row, col) — convenience for renderers/tests. */
export function cellAt(state: Game2048State, r: number, c: number): number {
  return getCell(state.cells, state.size, r, c);
}
