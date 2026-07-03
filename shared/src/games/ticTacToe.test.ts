import { describe, expect, it } from "vitest";
import {
  TICTACTOE_CELLS,
  TICTACTOE_LINES,
  applyTicTacToeMove,
  createTicTacToe,
  isTicTacToeLegalMove,
  ticTacToeLegalMoves,
} from "./ticTacToe.js";
import type { BoardPlayer, BoardState } from "./board.js";

/** Plays a sequence of [player, index] moves, asserting each is accepted. */
function play(moves: readonly (readonly [BoardPlayer, number])[]): BoardState {
  let state = createTicTacToe();
  for (const [player, index] of moves) {
    const outcome = applyTicTacToeMove(state, player, index);
    if (!outcome.ok) throw new Error(`unexpected rejection ${outcome.error} at ${player}/${index}`);
    state = outcome.state;
  }
  return state;
}

describe("createTicTacToe", () => {
  it("starts empty with player one to move", () => {
    const state = createTicTacToe();
    expect(state.board).toHaveLength(TICTACTOE_CELLS);
    expect(state.board.every((c) => c === 0)).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.result).toEqual({ status: "in_progress" });
  });
});

/**
 * Picks `count` off-line cells for the LOSER that never complete a line
 * themselves — so the only win is the one under test. (E.g. naively filling
 * cells 0,1,2 as the opponent's "fillers" would itself win the top row.)
 */
function safeFillers(line: readonly number[], count: number): number[] {
  const picked: number[] = [];
  for (let cell = 0; cell < TICTACTOE_CELLS && picked.length < count; cell += 1) {
    if (line.includes(cell)) continue;
    const trial = [...picked, cell];
    if (!TICTACTOE_LINES.some((l) => l.every((i) => trial.includes(i)))) picked.push(cell);
  }
  return picked;
}

/** Guarded filler accessor: safeFillers is built to supply enough cells, but
 *  index access is `number | undefined` under noUncheckedIndexedAccess, so we
 *  throw rather than assert with `!` (repo rule: no bare non-null assertions). */
function filler(fillers: readonly number[], i: number): number {
  const cell = fillers[i];
  if (cell === undefined) throw new Error(`ticTacToe test: safeFillers missing cell ${i}`);
  return cell;
}

describe("ticTacToe wins — every line for both players", () => {
  for (const line of TICTACTOE_LINES) {
    const [a, b, c] = line;

    it(`player 1 wins on line ${line.join("-")}`, () => {
      const f = safeFillers(line, 2);
      const state = play([
        [1, a],
        [2, filler(f, 0)],
        [1, b],
        [2, filler(f, 1)],
        [1, c],
      ]);
      expect(state.result).toEqual({ status: "won", winner: 1, line });
      expect(state.turn).toBe(1); // winner is the last mover
    });

    it(`player 2 wins on line ${line.join("-")}`, () => {
      const f = safeFillers(line, 3);
      const state = play([
        [1, filler(f, 0)],
        [2, a],
        [1, filler(f, 1)],
        [2, b],
        [1, filler(f, 2)],
        [2, c],
      ]);
      expect(state.result).toEqual({ status: "won", winner: 2, line });
    });
  }
});

describe("ticTacToe draw", () => {
  it("detects a full board with no winner", () => {
    // X O X / X O O / O X X  → full, no three-in-a-row.
    const state = play([
      [1, 0],
      [2, 1],
      [1, 2],
      [2, 4],
      [1, 3],
      [2, 5],
      [1, 7],
      [2, 6],
      [1, 8],
    ]);
    expect(state.result).toEqual({ status: "draw" });
    expect(ticTacToeLegalMoves(state)).toEqual([]);
  });
});

describe("ticTacToe illegal moves", () => {
  it("rejects out-of-turn (player 2 opening)", () => {
    expect(applyTicTacToeMove(createTicTacToe(), 2, 0)).toEqual({ ok: false, error: "out-of-turn" });
  });

  it.each([-1, 9, 100, 1.5, NaN])("rejects out-of-bounds index %p", (index) => {
    expect(applyTicTacToeMove(createTicTacToe(), 1, index)).toEqual({ ok: false, error: "out-of-bounds" });
  });

  it("rejects a move onto an occupied cell", () => {
    const state = play([[1, 4]]);
    expect(applyTicTacToeMove(state, 2, 4)).toEqual({ ok: false, error: "cell-occupied" });
  });

  it("rejects any move after the game is won", () => {
    const won = play([
      [1, 0],
      [2, 3],
      [1, 1],
      [2, 4],
      [1, 2],
    ]);
    expect(won.result.status).toBe("won");
    expect(applyTicTacToeMove(won, 2, 5)).toEqual({ ok: false, error: "game-over" });
  });

  it("does not mutate the input state", () => {
    const state = createTicTacToe();
    const before = state.board.slice();
    applyTicTacToeMove(state, 1, 0);
    expect(state.board).toEqual(before);
    expect(state.turn).toBe(1);
  });
});

describe("ticTacToe legality helpers", () => {
  it("legalMoves lists every empty cell while live and none after end", () => {
    expect(ticTacToeLegalMoves(createTicTacToe())).toHaveLength(TICTACTOE_CELLS);
    const won = play([
      [1, 0],
      [2, 3],
      [1, 1],
      [2, 4],
      [1, 2],
    ]);
    expect(ticTacToeLegalMoves(won)).toEqual([]);
  });

  it("isLegalMove agrees with applyMove acceptance", () => {
    const state = play([[1, 4]]);
    expect(isTicTacToeLegalMove(state, 2, 0)).toBe(true);
    expect(isTicTacToeLegalMove(state, 1, 0)).toBe(false); // out of turn
    expect(isTicTacToeLegalMove(state, 2, 4)).toBe(false); // occupied
    expect(isTicTacToeLegalMove(state, 2, 9)).toBe(false); // out of bounds
  });
});
