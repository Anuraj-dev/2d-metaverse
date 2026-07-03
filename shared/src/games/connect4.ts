/**
 * Connect-4 rules — pure, deterministic, no deps. 7 columns × 6 rows, stored as
 * a flat row-major array (index = row * COLS + col), row 0 at the TOP. A move is
 * a column index; the disc falls to the lowest empty row of that column. Win is
 * four in a row horizontally, vertically, or on either diagonal.
 *
 * See {@link ./board.ts} for the shared value types.
 */
import {
  type BoardPlayer,
  type BoardState,
  type Cell,
  type MoveOutcome,
  cellAt,
  otherPlayer,
} from "./board.js";

export const CONNECT4_COLS = 7;
export const CONNECT4_ROWS = 6;
export const CONNECT4_CELLS = CONNECT4_COLS * CONNECT4_ROWS;
export const CONNECT4_WIN = 4;

const index = (row: number, col: number): number => row * CONNECT4_COLS + col;

/** A fresh game: empty board, player one to move. */
export function createConnect4(): BoardState {
  return {
    board: Array<Cell>(CONNECT4_CELLS).fill(0),
    turn: 1,
    result: { status: "in_progress" },
  };
}

/** The lowest empty row in `col`, or -1 if the column is full. */
function dropRow(board: readonly Cell[], col: number): number {
  for (let row = CONNECT4_ROWS - 1; row >= 0; row -= 1) {
    if (cellAt(board, index(row, col)) === 0) return row;
  }
  return -1;
}

/** Column indices that are legal to play right now (not full ∧ game live). */
export function connect4LegalMoves(state: BoardState): number[] {
  if (state.result.status !== "in_progress") return [];
  const moves: number[] = [];
  for (let col = 0; col < CONNECT4_COLS; col += 1) {
    if (dropRow(state.board, col) >= 0) moves.push(col);
  }
  return moves;
}

/** Whether `player` may legally drop into `col` in `state`. */
export function isConnect4LegalMove(state: BoardState, player: BoardPlayer, col: number): boolean {
  if (state.result.status !== "in_progress") return false;
  if (state.turn !== player) return false;
  if (!Number.isInteger(col) || col < 0 || col >= CONNECT4_COLS) return false;
  return dropRow(state.board, col) >= 0;
}

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal ↘
  [1, -1], // diagonal ↙
];

/**
 * The winning run of {@link CONNECT4_WIN} cells through (row,col) for `player`,
 * or null. Scans both directions along each axis from the placed disc.
 */
function winningLine(board: readonly Cell[], player: BoardPlayer, row: number, col: number): number[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    const cells: number[] = [index(row, col)];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < CONNECT4_ROWS && c >= 0 && c < CONNECT4_COLS && cellAt(board, index(r, c)) === player) {
        cells.push(index(r, c));
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= CONNECT4_WIN) return cells.sort((a, b) => a - b);
  }
  return null;
}

/**
 * Apply `player`'s drop into `col`. Validates game-over, turn order, bounds and
 * a full column before mutating a COPY of the board; the input is untouched.
 */
export function applyConnect4Move(state: BoardState, player: BoardPlayer, col: number): MoveOutcome {
  if (state.result.status !== "in_progress") return { ok: false, error: "game-over" };
  if (state.turn !== player) return { ok: false, error: "out-of-turn" };
  if (!Number.isInteger(col) || col < 0 || col >= CONNECT4_COLS) return { ok: false, error: "out-of-bounds" };

  const row = dropRow(state.board, col);
  if (row < 0) return { ok: false, error: "column-full" };

  const board = state.board.slice();
  board[index(row, col)] = player;

  const line = winningLine(board, player, row, col);
  if (line) {
    return { ok: true, state: { board, turn: player, result: { status: "won", winner: player, line } } };
  }
  if (board.every((cell) => cell !== 0)) {
    return { ok: true, state: { board, turn: player, result: { status: "draw" } } };
  }
  return { ok: true, state: { board, turn: otherPlayer(player), result: { status: "in_progress" } } };
}
