import { describe, expect, it } from "vitest";
import { rulesFor, type BoardRules } from "@metaverse/shared";
import {
  IDLE_BOARD_MATCH,
  boardMatchTransition,
  seatOf,
  type BoardMatchEffect,
  type BoardMatchEvent,
  type BoardMatchState,
} from "../src/boardMatch.js";

/**
 * Exhaustive transition tests for the board-table match machine — the single
 * place the match lifecycle lives (see CLAUDE.md). Written from the PRD 11
 * phase-2 spec: both seats ⇒ offer; both accept ⇒ start; illegal/out-of-turn
 * move rejected; stand/leave ⇒ forfeit (offer ⇒ cancel); win/draw ⇒ over; both
 * empty ⇒ waiting. Includes illegal transitions.
 */

const ttt: BoardRules = rulesFor("tictactoe");

/** Reduce a script of events, returning the final state and the last effects. */
function run(events: readonly BoardMatchEvent[], rules: BoardRules = ttt): { state: BoardMatchState; effects: BoardMatchEffect[] } {
  let state = IDLE_BOARD_MATCH;
  let effects: BoardMatchEffect[] = [];
  for (const event of events) {
    const result = boardMatchTransition(state, event, rules);
    state = result.state;
    effects = result.effects;
  }
  return { state, effects };
}

/** Narrows to an active match (throws, so no `expect` sits in a conditional). */
function activeMatch(state: BoardMatchState): Extract<BoardMatchState["match"], { phase: "active" }> {
  if (state.match.phase !== "active") throw new Error(`expected active, got ${state.match.phase}`);
  return state.match;
}
function overMatch(state: BoardMatchState): Extract<BoardMatchState["match"], { phase: "over" }> {
  if (state.match.phase !== "over") throw new Error(`expected over, got ${state.match.phase}`);
  return state.match;
}

const sit = (seat: 0 | 1, playerId: string): BoardMatchEvent => ({ type: "sit", seat, playerId });
const stand = (playerId: string): BoardMatchEvent => ({ type: "stand", playerId });
const accept = (playerId: string): BoardMatchEvent => ({ type: "accept", playerId });
const move = (playerId: string, index: number): BoardMatchEvent => ({ type: "move", playerId, index });

/** Sit both players and accept ⇒ an active match with a fresh board. */
const bothReady: BoardMatchEvent[] = [sit(0, "a"), sit(1, "b"), accept("a"), accept("b")];

describe("seat occupancy → offer", () => {
  it("one seat is waiting, both seats open an offer", () => {
    expect(run([sit(0, "a")]).state.match.phase).toBe("waiting");
    const offer = run([sit(0, "a"), sit(1, "b")]);
    expect(offer.state.match).toEqual({ phase: "offer", accepted: [false, false] });
    expect(offer.state.occupants).toEqual(["a", "b"]);
  });

  it("rejects sitting on an occupied seat", () => {
    const { state, effects } = run([sit(0, "a"), sit(0, "b")]);
    expect(effects).toEqual([{ type: "rejected", playerId: "b", reason: "seat-taken" }]);
    expect(state.occupants).toEqual(["a", null]);
  });

  it("re-sitting the same seat is a no-op", () => {
    expect(run([sit(0, "a"), sit(0, "a")]).effects).toEqual([]);
  });

  it("standing before a match just clears the seat", () => {
    const { state } = run([sit(0, "a"), stand("a")]);
    expect(state).toEqual(IDLE_BOARD_MATCH);
  });
});

describe("offer → active", () => {
  it("one acceptance keeps the offer, both start the match", () => {
    const partial = run([sit(0, "a"), sit(1, "b"), accept("a")]);
    expect(partial.state.match).toEqual({ phase: "offer", accepted: [true, false] });

    const started = run(bothReady);
    expect(started.effects).toContainEqual({ type: "started" });
    const game = activeMatch(started.state).game;
    expect(game.turn).toBe(1);
    expect(game.board.every((c) => c === 0)).toBe(true);
  });

  it("standing during an offer cancels it back to waiting", () => {
    const { state } = run([sit(0, "a"), sit(1, "b"), accept("a"), stand("b")]);
    expect(state.match.phase).toBe("waiting");
    expect(state.occupants).toEqual(["a", null]);
  });

  it("accept from a non-seated id is rejected, accept with no offer is no-match", () => {
    expect(run([sit(0, "a"), sit(1, "b"), accept("z")]).effects).toEqual([
      { type: "rejected", playerId: "z", reason: "not-seated" },
    ]);
    expect(run([sit(0, "a"), accept("a")]).effects).toEqual([
      { type: "rejected", playerId: "a", reason: "no-match" },
    ]);
  });
});

describe("active moves — validation", () => {
  it("accepts a legal move by the player to move and flips the turn", () => {
    const game = activeMatch(run([...bothReady, move("a", 4)]).state).game;
    expect(game.board[4]).toBe(1);
    expect(game.turn).toBe(2);
  });

  it("rejects an out-of-turn move (seat 1 moving first)", () => {
    expect(run([...bothReady, move("b", 0)]).effects).toEqual([
      { type: "rejected", playerId: "b", reason: "not-your-turn" },
    ]);
  });

  it("rejects an illegal move (occupied cell)", () => {
    const { effects, state } = run([...bothReady, move("a", 4), move("b", 4)]);
    expect(effects).toEqual([{ type: "rejected", playerId: "b", reason: "illegal-move" }]);
    // State unchanged by the rejected move: still seat 1's turn.
    expect(activeMatch(state).game.turn).toBe(2);
  });

  it("rejects a move from a spectator (not seated)", () => {
    expect(run([...bothReady, move("z", 0)]).effects).toEqual([
      { type: "rejected", playerId: "z", reason: "not-seated" },
    ]);
  });

  it("rejects a move before the match is active (no-match)", () => {
    expect(run([sit(0, "a"), sit(1, "b"), move("a", 0)]).effects).toEqual([
      { type: "rejected", playerId: "a", reason: "no-match" },
    ]);
  });
});

describe("match end", () => {
  it("a winning move ends the match with reason win", () => {
    // a:0,1,2 (top row) wins; b plays 3,4 between.
    const { state, effects } = run([...bothReady, move("a", 0), move("b", 3), move("a", 1), move("b", 4), move("a", 2)]);
    const over = overMatch(state);
    expect(over.reason).toBe("win");
    expect(over.game.result).toMatchObject({ status: "won", winner: 1 });
    expect(effects).toContainEqual({ type: "ended", reason: "win" });
  });

  it("a stand during a live match forfeits (empty seat loses)", () => {
    const { state, effects } = run([...bothReady, move("a", 0), stand("a")]);
    expect(overMatch(state).reason).toBe("forfeit");
    expect(state.occupants).toEqual([null, "b"]); // seat 0 (forfeiter) emptied
    expect(effects).toContainEqual({ type: "ended", reason: "forfeit" });
  });

  it("rejects moves after the match is over", () => {
    expect(run([...bothReady, move("a", 0), stand("a"), move("b", 5)]).effects).toEqual([
      { type: "rejected", playerId: "b", reason: "no-match" },
    ]);
  });

  it("the last stander returns the table to waiting; a new sit offers a rematch", () => {
    const done = [...bothReady, move("a", 0), move("b", 3), move("a", 1), move("b", 4), move("a", 2)];
    const reset = run([...done, stand("a"), stand("b")]);
    expect(reset.state).toEqual(IDLE_BOARD_MATCH);

    const rematch = run([...done, stand("a"), sit(0, "c")]);
    // 'over' with one empty seat + a new sitter re-opens an offer.
    expect(rematch.state.match.phase).toBe("offer");
    expect(rematch.state.occupants).toEqual(["c", "b"]);
  });
});

describe("seatOf helper", () => {
  it("locates a player's seat or returns null", () => {
    expect(seatOf(["a", "b"], "b")).toBe(1);
    expect(seatOf(["a", null], "b")).toBeNull();
  });
});
