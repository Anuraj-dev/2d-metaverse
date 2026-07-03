/**
 * Common types for the two-player board games (tic-tac-toe, Connect-4).
 *
 * These are pure value types: no zod, no io, no deps. Both the backend
 * (authoritative validation) and the frontend (optimistic rendering) import
 * this ONE implementation — the board rules are never re-derived. The wire
 * schemas in `socket.ts` mirror these shapes so a validated match state can
 * travel over the socket unchanged.
 */

/** A board cell: 0 = empty, 1 = player one, 2 = player two. */
export type Cell = 0 | 1 | 2;

/** A player mark. Player one always moves first. */
export type BoardPlayer = 1 | 2;

/** Canonical board-game ids. */
export const BOARD_GAMES = ["tictactoe", "connect4"] as const;
export type BoardGame = (typeof BOARD_GAMES)[number];

/**
 * The outcome of a game. `line` lists the winning cell indices (row-major) so a
 * renderer can highlight them; it is omitted for draws and in-progress games.
 */
export type BoardResult =
  | { status: "in_progress" }
  | { status: "won"; winner: BoardPlayer; line: readonly number[] }
  | { status: "draw" };

/** Reasons a move is rejected. Shared across both games. */
export const BOARD_MOVE_ERRORS = [
  "game-over",
  "out-of-turn",
  "out-of-bounds",
  "cell-occupied",
  "column-full",
] as const;
export type BoardMoveError = (typeof BOARD_MOVE_ERRORS)[number];

/**
 * Serializable game state that travels over the wire and drives rendering.
 * `board` is a flat row-major array of {@link Cell}; `turn` is the player to
 * move next; `result` is the current outcome.
 */
export interface BoardState {
  board: Cell[];
  turn: BoardPlayer;
  result: BoardResult;
}

/** Result of applying a move: the next state, or a typed rejection. */
export type MoveOutcome =
  | { ok: true; state: BoardState }
  | { ok: false; error: BoardMoveError };

/** The player who is NOT `player`. */
export function otherPlayer(player: BoardPlayer): BoardPlayer {
  return player === 1 ? 2 : 1;
}

/** Reads a cell, treating out-of-range indices as empty (0). */
export function cellAt(board: readonly Cell[], index: number): Cell {
  return board[index] ?? 0;
}
