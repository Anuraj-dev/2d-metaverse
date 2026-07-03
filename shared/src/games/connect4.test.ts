import { describe, expect, it } from "vitest";
import {
  CONNECT4_CELLS,
  CONNECT4_COLS,
  CONNECT4_ROWS,
  applyConnect4Move,
  connect4LegalMoves,
  createConnect4,
  isConnect4LegalMove,
} from "./connect4.js";
import type { BoardPlayer, BoardState, Cell } from "./board.js";

const at = (row: number, col: number): number => row * CONNECT4_COLS + col;

/** Plays a sequence of [player, col] drops, asserting each is accepted. */
function play(moves: readonly (readonly [BoardPlayer, number])[]): BoardState {
  let state = createConnect4();
  for (const [player, col] of moves) {
    const outcome = applyConnect4Move(state, player, col);
    if (!outcome.ok) throw new Error(`unexpected rejection ${outcome.error} at ${player}/col${col}`);
    state = outcome.state;
  }
  return state;
}

describe("createConnect4", () => {
  it("starts empty with player one to move", () => {
    const state = createConnect4();
    expect(state.board).toHaveLength(CONNECT4_CELLS);
    expect(state.board.every((c) => c === 0)).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.result).toEqual({ status: "in_progress" });
  });
});

describe("connect4 wins — all four directions", () => {
  it("vertical (player 1)", () => {
    const state = play([
      [1, 0],
      [2, 1],
      [1, 0],
      [2, 1],
      [1, 0],
      [2, 1],
      [1, 0],
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 1,
      line: [at(2, 0), at(3, 0), at(4, 0), at(5, 0)],
    });
  });

  it("horizontal (player 1)", () => {
    const state = play([
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
      [1, 3],
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 1,
      line: [at(5, 0), at(5, 1), at(5, 2), at(5, 3)],
    });
  });

  it("ascending diagonal ↗ (player 2)", () => {
    // p2 completes (5,0)-(4,1)-(3,2)-(2,3) on the final move.
    const state = play([
      [1, 1], // (5,1) filler
      [2, 0], // (5,0) D
      [1, 2], // (5,2) filler
      [2, 1], // (4,1) D
      [1, 2], // (4,2) filler
      [2, 2], // (3,2) D
      [1, 3], // (5,3) filler
      [2, 3], // (4,3) filler
      [1, 3], // (3,3) filler
      [2, 3], // (2,3) D — win
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 2,
      line: [at(2, 3), at(3, 2), at(4, 1), at(5, 0)],
    });
  });

  it("descending diagonal ↘ (player 2)", () => {
    // p2 completes (2,0)-(3,1)-(4,2)-(5,3) on the final move.
    const state = play([
      [1, 2], // (5,2) filler
      [2, 3], // (5,3) D
      [1, 1], // (5,1) filler
      [2, 2], // (4,2) D
      [1, 1], // (4,1) filler
      [2, 1], // (3,1) D
      [1, 0], // (5,0) filler
      [2, 0], // (4,0) filler
      [1, 0], // (3,0) filler
      [2, 0], // (2,0) D — win
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 2,
      line: [at(2, 0), at(3, 1), at(4, 2), at(5, 3)],
    });
  });

  it("vertical (player 2)", () => {
    // p1 fillers are scattered (col1, col3, col5, then a second in col1) so
    // they never form a four themselves; p2 stacks four in col0.
    const state = play([
      [1, 1],
      [2, 0],
      [1, 3],
      [2, 0],
      [1, 5],
      [2, 0],
      [1, 1],
      [2, 0],
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 2,
      line: [at(2, 0), at(3, 0), at(4, 0), at(5, 0)],
    });
  });

  it("horizontal (player 2)", () => {
    // p1 fillers land at row5 cols4-6 (adjacent but only three, plus a
    // second disc in col4) so they never form a four; p2 fills row5 cols0-3.
    const state = play([
      [1, 4],
      [2, 0],
      [1, 5],
      [2, 1],
      [1, 6],
      [2, 2],
      [1, 4],
      [2, 3],
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 2,
      line: [at(5, 0), at(5, 1), at(5, 2), at(5, 3)],
    });
  });

  it("ascending diagonal ↗ (player 1)", () => {
    // Same shape as the p2 ascending-diagonal case above, but with an extra
    // leading p1 filler move (col6) that flips the turn parity so player 1
    // ends up placing the D-cells and player 2 the fillers.
    const state = play([
      [1, 6], // dummy filler, flips parity
      [2, 1], // (5,1) filler
      [1, 0], // (5,0) D
      [2, 2], // (5,2) filler
      [1, 1], // (4,1) D
      [2, 2], // (4,2) filler
      [1, 2], // (3,2) D
      [2, 3], // (5,3) filler
      [1, 3], // (4,3) filler
      [2, 3], // (3,3) filler
      [1, 3], // (2,3) D — win
    ]);
    expect(state.result.status).toBe("won");
    expect(state.result).toMatchObject({ winner: 1 });
    if (state.result.status === "won") {
      expect(new Set(state.result.line)).toEqual(new Set([at(2, 3), at(3, 2), at(4, 1), at(5, 0)]));
    }
  });

  it("descending diagonal ↘ (player 1)", () => {
    // Same shape as the p2 descending-diagonal case above, with the same
    // parity-flipping leading dummy move so player 1 places the D-cells.
    const state = play([
      [1, 6], // dummy filler, flips parity
      [2, 2], // (5,2) filler
      [1, 3], // (5,3) D
      [2, 1], // (5,1) filler
      [1, 2], // (4,2) D
      [2, 1], // (4,1) filler
      [1, 1], // (3,1) D
      [2, 0], // (5,0) filler
      [1, 0], // (4,0) filler
      [2, 0], // (3,0) filler
      [1, 0], // (2,0) D — win
    ]);
    expect(state.result.status).toBe("won");
    expect(state.result).toMatchObject({ winner: 1 });
    if (state.result.status === "won") {
      expect(new Set(state.result.line)).toEqual(new Set([at(2, 0), at(3, 1), at(4, 2), at(5, 3)]));
    }
  });

  it("edge: vertical win in the last column (col 6, player 1)", () => {
    const state = play([
      [1, 6],
      [2, 5],
      [1, 6],
      [2, 5],
      [1, 6],
      [2, 5],
      [1, 6],
    ]);
    expect(state.result).toEqual({
      status: "won",
      winner: 1,
      line: [at(2, 6), at(3, 6), at(4, 6), at(5, 6)],
    });
  });

  it("mid-run: horizontal win completed by a disc dropped into the gap between already-played ends", () => {
    // Player 1 plays cols 0, 1, 3 (leaving col 2 as a gap) with unrelated
    // player-2 fillers between, then finally drops in col 2 — the winning
    // disc lands in the middle of the four-in-a-row, not at either end.
    const state = play([
      [1, 0],
      [2, 4],
      [1, 1],
      [2, 4],
      [1, 3],
      [2, 5],
      [1, 2], // fills the gap — win
    ]);
    expect(state.result.status).toBe("won");
    expect(state.result).toMatchObject({ winner: 1 });
    if (state.result.status === "won") {
      expect(new Set(state.result.line)).toEqual(new Set([at(5, 0), at(5, 1), at(5, 2), at(5, 3)]));
    }
  });
});

describe("connect4 draw", () => {
  it("detects a full board with no four-in-a-row", () => {
    // A "brick" pattern (colour flips every two rows) has max run length 2 in
    // every line. Hand-build it full except the top of column 0, then drop the
    // last disc and assert a draw.
    const owner = (row: number, col: number): Cell => (((col + (row >> 1)) % 2) === 0 ? 1 : 2);
    const board = Array.from({ length: CONNECT4_CELLS }, (_, i) =>
      owner(Math.floor(i / CONNECT4_COLS), i % CONNECT4_COLS),
    );
    board[at(0, 0)] = 0; // last empty cell (top of column 0)
    const lastPlayer: BoardPlayer = owner(0, 0) === 1 ? 1 : 2;

    const outcome = applyConnect4Move({ board, turn: lastPlayer, result: { status: "in_progress" } }, lastPlayer, 0);
    if (!outcome.ok) throw new Error(`expected the final drop to be accepted, got ${outcome.error}`);
    expect(outcome.state.result).toEqual({ status: "draw" });
    expect(connect4LegalMoves(outcome.state)).toEqual([]);
  });
});

describe("connect4 illegal moves", () => {
  it("rejects out-of-turn (player 2 opening)", () => {
    expect(applyConnect4Move(createConnect4(), 2, 0)).toEqual({ ok: false, error: "out-of-turn" });
  });

  it.each([-1, CONNECT4_COLS, 100, 1.5, NaN])("rejects out-of-bounds column %p", (col) => {
    expect(applyConnect4Move(createConnect4(), 1, col)).toEqual({ ok: false, error: "out-of-bounds" });
  });

  it("rejects a drop into a full column", () => {
    // Fill column 0 with six alternating discs (no vertical four), then drop again.
    const state = play([
      [1, 0],
      [2, 0],
      [1, 0],
      [2, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(state.turn).toBe(1);
    expect(applyConnect4Move(state, 1, 0)).toEqual({ ok: false, error: "column-full" });
  });

  it("rejects any move after the game is won", () => {
    const won = play([
      [1, 0],
      [2, 1],
      [1, 0],
      [2, 1],
      [1, 0],
      [2, 1],
      [1, 0],
    ]);
    expect(won.result.status).toBe("won");
    expect(applyConnect4Move(won, 2, 3)).toEqual({ ok: false, error: "game-over" });
  });

  it("does not mutate the input state", () => {
    const state = createConnect4();
    const before = state.board.slice();
    applyConnect4Move(state, 1, 3);
    expect(state.board).toEqual(before);
    expect(state.turn).toBe(1);
  });
});

describe("connect4 legality helpers", () => {
  it("legalMoves lists every non-full column while live", () => {
    expect(connect4LegalMoves(createConnect4())).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("drops fall to the lowest empty row", () => {
    const state = play([[1, 3]]);
    expect(state.board[at(CONNECT4_ROWS - 1, 3)]).toBe(1);
    expect(state.board[at(CONNECT4_ROWS - 2, 3)]).toBe(0);
  });

  it("isLegalMove agrees with applyMove acceptance", () => {
    const state = play([[1, 0]]);
    expect(isConnect4LegalMove(state, 2, 0)).toBe(true);
    expect(isConnect4LegalMove(state, 1, 0)).toBe(false); // out of turn
    expect(isConnect4LegalMove(state, 2, CONNECT4_COLS)).toBe(false); // out of bounds
  });
});
