/**
 * Game-rules adapter: resolves a {@link BoardGame} id to its pure rule
 * functions, so the match machine (backend) and the board UI (frontend) drive
 * either game through one uniform interface. No deps beyond the two rule
 * modules — still pure and deterministic.
 */
import { type BoardGame, type BoardPlayer, type BoardState, type MoveOutcome } from "./board.js";
import { applyTicTacToeMove, createTicTacToe } from "./ticTacToe.js";
import { applyConnect4Move, createConnect4 } from "./connect4.js";

export interface BoardRules {
  /** A fresh game state (player one to move). */
  create(): BoardState;
  /** Apply `player`'s move at `index`; returns the next state or a typed error. */
  applyMove(state: BoardState, player: BoardPlayer, index: number): MoveOutcome;
}

const TICTACTOE_RULES: BoardRules = { create: createTicTacToe, applyMove: applyTicTacToeMove };
const CONNECT4_RULES: BoardRules = { create: createConnect4, applyMove: applyConnect4Move };

/** The rule functions for a board game. */
export function rulesFor(game: BoardGame): BoardRules {
  return game === "tictactoe" ? TICTACTOE_RULES : CONNECT4_RULES;
}
