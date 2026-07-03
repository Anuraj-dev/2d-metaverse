/**
 * Board-table match state machine — THE single place the two-player match
 * lifecycle lives (referenced from CLAUDE.md). Pure: plain values in, plain
 * values out; no io, no Redis, no timers. The manager shell (board-manager.ts)
 * owns the disconnect-grace timer, Redis persistence and room-scoped broadcasts,
 * feeding events + the table's {@link BoardRules} through {@link boardMatchTransition}.
 *
 * Lifecycle (PRD 11 phase 2):
 *   - Both seats occupied ⇒ a match OFFER (each seat must accept).
 *   - Both accept ⇒ the match STARTS (a fresh game, player one = seat 0).
 *   - A move is validated against seat, turn order and the shared rules; an
 *     illegal/out-of-turn move is rejected and the state is untouched.
 *   - A stand/leave during a live match ⇒ FORFEIT (the empty seat lost); during
 *     an offer ⇒ the offer is simply canceled.
 *   - A win/draw ⇒ the match is OVER; the finished board stays visible until a
 *     player stands. When both seats empty the table returns to waiting.
 *   - A disconnect is a stand after a grace window (the shell schedules it).
 */
import type { BoardEndReason, BoardMoveRejection, BoardPlayer, BoardRules, BoardState } from "@metaverse/shared";

/** Seat index at a two-seat table. Seat 0 plays mark 1, seat 1 plays mark 2. */
export type Seat = 0 | 1;

/** Occupants by seat; null = empty. */
export type Occupants = readonly [string | null, string | null];

export type MatchPhase =
  | { phase: "waiting" }
  | { phase: "offer"; accepted: readonly [boolean, boolean] }
  | { phase: "active"; game: BoardState }
  | { phase: "over"; game: BoardState; reason: BoardEndReason };

export interface BoardMatchState {
  occupants: Occupants;
  match: MatchPhase;
}

export type BoardMatchEvent =
  | { type: "sit"; seat: Seat; playerId: string }
  | { type: "stand"; playerId: string }
  | { type: "accept"; playerId: string }
  | { type: "move"; playerId: string; index: number };

export type BoardMatchEffect =
  | { type: "changed" }
  | { type: "started" }
  | { type: "ended"; reason: BoardEndReason }
  | { type: "rejected"; playerId: string; reason: BoardMoveRejection };

export interface BoardMatchResult {
  state: BoardMatchState;
  effects: BoardMatchEffect[];
}

export const IDLE_BOARD_MATCH: BoardMatchState = {
  occupants: [null, null],
  match: { phase: "waiting" },
};

/** The seat holding `playerId`, or null. */
export function seatOf(occupants: Occupants, playerId: string): Seat | null {
  if (occupants[0] === playerId) return 0;
  if (occupants[1] === playerId) return 1;
  return null;
}

const bothFilled = (occ: Occupants): boolean => occ[0] !== null && occ[1] !== null;
const markOf = (seat: Seat): BoardPlayer => (seat === 0 ? 1 : 2);

function withSeat(occ: Occupants, seat: Seat, value: string | null): Occupants {
  return seat === 0 ? [value, occ[1]] : [occ[0], value];
}

const stay = (state: BoardMatchState): BoardMatchResult => ({ state, effects: [] });
const reject = (state: BoardMatchState, playerId: string, reason: BoardMoveRejection): BoardMatchResult => ({
  state,
  effects: [{ type: "rejected", playerId, reason }],
});

/**
 * Apply an event to a table's match state. `rules` are the fixed rule functions
 * for this table's game (resolved once per table from the shared registry).
 */
export function boardMatchTransition(
  state: BoardMatchState,
  event: BoardMatchEvent,
  rules: BoardRules,
): BoardMatchResult {
  const { occupants, match } = state;

  switch (event.type) {
    case "sit": {
      const held = occupants[event.seat];
      if (held !== null && held !== event.playerId) return reject(state, event.playerId, "seat-taken");
      // Move the player onto the chosen seat (clearing any seat they held).
      const cleared = withSeat(withSeat(occupants, 0, occupants[0] === event.playerId ? null : occupants[0]), 1, occupants[1] === event.playerId ? null : occupants[1]);
      const next = withSeat(cleared, event.seat, event.playerId);
      if (next[0] === occupants[0] && next[1] === occupants[1]) return stay(state);
      // Filling the second seat (from waiting, or into a forfeited seat during
      // "over") opens a fresh offer; anything else keeps the current phase.
      if (bothFilled(next) && (match.phase === "waiting" || match.phase === "over")) {
        return { state: { occupants: next, match: { phase: "offer", accepted: [false, false] } }, effects: [{ type: "changed" }] };
      }
      return { state: { occupants: next, match }, effects: [{ type: "changed" }] };
    }

    case "stand": {
      const seat = seatOf(occupants, event.playerId);
      if (seat === null) return stay(state);
      const next = withSeat(occupants, seat, null);
      switch (match.phase) {
        case "waiting":
          return { state: { occupants: next, match }, effects: [{ type: "changed" }] };
        case "offer":
          return { state: { occupants: next, match: { phase: "waiting" } }, effects: [{ type: "changed" }] };
        case "active":
          return {
            state: { occupants: next, match: { phase: "over", game: match.game, reason: "forfeit" } },
            effects: [{ type: "changed" }, { type: "ended", reason: "forfeit" }],
          };
        case "over":
          if (next[0] === null && next[1] === null) {
            return { state: { occupants: next, match: { phase: "waiting" } }, effects: [{ type: "changed" }] };
          }
          return { state: { occupants: next, match }, effects: [{ type: "changed" }] };
      }
      return stay(state);
    }

    case "accept": {
      if (match.phase !== "offer") return reject(state, event.playerId, "no-match");
      const seat = seatOf(occupants, event.playerId);
      if (seat === null) return reject(state, event.playerId, "not-seated");
      const accepted: [boolean, boolean] = [match.accepted[0], match.accepted[1]];
      accepted[seat] = true;
      if (accepted[0] && accepted[1]) {
        return {
          state: { occupants, match: { phase: "active", game: rules.create() } },
          effects: [{ type: "changed" }, { type: "started" }],
        };
      }
      return { state: { occupants, match: { phase: "offer", accepted } }, effects: [{ type: "changed" }] };
    }

    case "move": {
      if (match.phase !== "active") return reject(state, event.playerId, "no-match");
      const seat = seatOf(occupants, event.playerId);
      if (seat === null) return reject(state, event.playerId, "not-seated");
      const mark = markOf(seat);
      if (match.game.turn !== mark) return reject(state, event.playerId, "not-your-turn");
      const outcome = rules.applyMove(match.game, mark, event.index);
      if (!outcome.ok) return reject(state, event.playerId, "illegal-move");
      const game = outcome.state;
      if (game.result.status === "won" || game.result.status === "draw") {
        const reason: BoardEndReason = game.result.status === "won" ? "win" : "draw";
        return {
          state: { occupants, match: { phase: "over", game, reason } },
          effects: [{ type: "changed" }, { type: "ended", reason }],
        };
      }
      return { state: { occupants, match: { phase: "active", game } }, effects: [{ type: "changed" }] };
    }
  }
}
