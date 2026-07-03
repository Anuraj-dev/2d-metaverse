/**
 * Tic-tac-toe rules — pure, deterministic, no deps. 3×3 board, indices 0..8
 * row-major:
 *
 *   0 1 2
 *   3 4 5
 *   6 7 8
 *
 * A move is a cell index. See {@link ./board.ts} for the shared value types.
 */
import {
  type BoardPlayer,
  type BoardState,
  type Cell,
  type MoveOutcome,
  cellAt,
  otherPlayer,
} from "./board.js";

export const TICTACTOE_SIZE = 3;
export const TICTACTOE_CELLS = TICTACTOE_SIZE * TICTACTOE_SIZE;

/** The eight winning lines (row-major cell indices). */
export const TICTACTOE_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** A fresh game: empty board, player one to move. */
export function createTicTacToe(): BoardState {
  return {
    board: Array<Cell>(TICTACTOE_CELLS).fill(0),
    turn: 1,
    result: { status: "in_progress" },
  };
}

/** Cell indices that are legal to play right now (empty ∧ game live). */
export function ticTacToeLegalMoves(state: BoardState): number[] {
  if (state.result.status !== "in_progress") return [];
  const moves: number[] = [];
  for (let i = 0; i < TICTACTOE_CELLS; i += 1) {
    if (cellAt(state.board, i) === 0) moves.push(i);
  }
  return moves;
}

/** Whether `player` may legally play `index` in `state`. */
export function isTicTacToeLegalMove(state: BoardState, player: BoardPlayer, index: number): boolean {
  if (state.result.status !== "in_progress") return false;
  if (state.turn !== player) return false;
  if (!Number.isInteger(index) || index < 0 || index >= TICTACTOE_CELLS) return false;
  return cellAt(state.board, index) === 0;
}

/** The winning line for `player` on `board`, or null. */
function winningLine(board: readonly Cell[], player: BoardPlayer): number[] | null {
  for (const line of TICTACTOE_LINES) {
    if (line.every((i) => cellAt(board, i) === player)) return [...line];
  }
  return null;
}

/**
 * Apply `player`'s move at `index`. Validates game-over, turn order, bounds and
 * occupancy before mutating a COPY of the board; the input state is untouched.
 */
export function applyTicTacToeMove(state: BoardState, player: BoardPlayer, index: number): MoveOutcome {
  if (state.result.status !== "in_progress") return { ok: false, error: "game-over" };
  if (state.turn !== player) return { ok: false, error: "out-of-turn" };
  if (!Number.isInteger(index) || index < 0 || index >= TICTACTOE_CELLS) {
    return { ok: false, error: "out-of-bounds" };
  }
  if (cellAt(state.board, index) !== 0) return { ok: false, error: "cell-occupied" };

  const board = state.board.slice();
  board[index] = player;

  const line = winningLine(board, player);
  if (line) {
    return { ok: true, state: { board, turn: player, result: { status: "won", winner: player, line } } };
  }
  if (board.every((cell) => cell !== 0)) {
    return { ok: true, state: { board, turn: player, result: { status: "draw" } } };
  }
  return { ok: true, state: { board, turn: otherPlayer(player), result: { status: "in_progress" } } };
}
