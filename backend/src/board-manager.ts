/**
 * Side-effect shell around the pure board-match machine (boardMatch.ts). Owns
 * per-table machine state, the disconnect-grace timer, Redis persistence of the
 * live snapshot (with TTL), and the translation of machine effects into
 * space-scoped `board-update` broadcasts and per-client `board-error` replies.
 *
 * Dependencies are injected (name resolver, broadcaster, error sender, persister)
 * so the manager stays unit-testable without Socket.IO or Redis; the socket layer
 * provides the real implementations.
 *
 * Dispatches are serialized per table: each table has its own promise queue so
 * two racing moves cannot interleave their transitions.
 */
import {
  BOARD_TABLES,
  gameForTable,
  rulesFor,
  type BoardEndReason,
  type BoardOccupant,
  type BoardErrorPayload,
  type BoardGame,
  type BoardRules,
  type BoardUpdatePayload,
} from "@metaverse/shared";
import { IDLE_BOARD_MATCH, boardMatchTransition, seatOf, type BoardMatchEvent, type BoardMatchState } from "./boardMatch.js";
import type { Logger } from "pino";

export interface BoardManagerDeps {
  graceMs: number;
  ttlSeconds: number;
  resolveName: (playerId: string) => string;
  /** Broadcast a full snapshot space-wide (seated players + spectators). */
  broadcast: (payload: BoardUpdatePayload) => void;
  /** Send a typed rejection to a single player. */
  sendError: (playerId: string, payload: BoardErrorPayload) => void;
  /** Persist (snapshot) or clear (null) the Redis mirror of a table. */
  persist: (tableId: string, snapshot: BoardUpdatePayload | null) => void;
  log: Logger;
}

export interface BoardManager {
  /** Feed a table event; effects broadcast asynchronously. */
  dispatch: (tableId: string, event: BoardMatchEvent) => void;
  /** Stand a player from whichever table holds them (no-op if none). */
  stand: (playerId: string) => void;
  /** On disconnect: after the grace window, stand the player from their table. */
  scheduleForfeit: (playerId: string) => void;
  /** On reconnect/rejoin: cancel a pending disconnect forfeit. */
  cancelForfeit: (playerId: string) => void;
  /** The current authoritative snapshot for a table (for join-time sync). */
  currentSnapshot: (tableId: string) => BoardUpdatePayload | null;
  /** Await all in-flight dispatches (test synchronization only). */
  settle: () => Promise<void>;
}

interface TableRuntime {
  game: BoardGame;
  rules: BoardRules;
  state: BoardMatchState;
  queue: Promise<void>;
}

export function createBoardManager(deps: BoardManagerDeps): BoardManager {
  const tables = new Map<string, TableRuntime>();
  const graceTimers = new Map<string, NodeJS.Timeout>();

  const runtime = (tableId: string): TableRuntime | undefined => {
    let table = tables.get(tableId);
    if (table) return table;
    const game = gameForTable(tableId);
    if (!game) return undefined;
    table = { game, rules: rulesFor(game), state: IDLE_BOARD_MATCH, queue: Promise.resolve() };
    tables.set(tableId, table);
    return table;
  };

  const occupant = (state: BoardMatchState, seat: 0 | 1): BoardOccupant | null => {
    const id = state.occupants[seat];
    if (id === null) return null;
    const accepted = state.match.phase === "offer" ? state.match.accepted[seat] : state.match.phase !== "waiting";
    return { id, name: deps.resolveName(id), accepted };
  };

  const snapshot = (tableId: string, table: TableRuntime): BoardUpdatePayload => {
    const { state, game } = table;
    const gameState = state.match.phase === "active" || state.match.phase === "over" ? state.match.game : null;
    const reason: BoardEndReason | null = state.match.phase === "over" ? state.match.reason : null;
    return {
      tableId: tableId as BoardUpdatePayload["tableId"],
      game,
      phase: state.match.phase,
      seats: [occupant(state, 0), occupant(state, 1)],
      state: gameState,
      reason,
    };
  };

  const isIdle = (state: BoardMatchState): boolean =>
    state.match.phase === "waiting" && state.occupants[0] === null && state.occupants[1] === null;

  const apply = (tableId: string, table: TableRuntime, event: BoardMatchEvent): void => {
    const { state, effects } = boardMatchTransition(table.state, event, table.rules);
    table.state = state;
    for (const effect of effects) {
      switch (effect.type) {
        case "changed": {
          const snap = snapshot(tableId, table);
          deps.broadcast(snap);
          deps.persist(tableId, isIdle(state) ? null : snap);
          break;
        }
        case "started":
          deps.log.info({ tableId, game: table.game }, "board match started");
          break;
        case "ended":
          deps.log.info({ tableId, reason: effect.reason }, "board match ended");
          break;
        case "rejected":
          deps.sendError(effect.playerId, {
            tableId: tableId as BoardErrorPayload["tableId"],
            reason: effect.reason,
          });
          break;
      }
    }
  };

  const dispatch = (tableId: string, event: BoardMatchEvent): void => {
    const table = runtime(tableId);
    if (!table) {
      deps.log.warn({ tableId }, "board dispatch for unknown table");
      return;
    }
    table.queue = table.queue
      .then(() => apply(tableId, table, event))
      .catch((error: unknown) => deps.log.error({ err: error, tableId, event }, "board dispatch failed"));
  };

  const tableHolding = (playerId: string): string | null => {
    for (const [tableId, table] of tables) {
      if (seatOf(table.state.occupants, playerId) !== null) return tableId;
    }
    return null;
  };

  const stand = (playerId: string): void => {
    const tableId = tableHolding(playerId);
    if (tableId) dispatch(tableId, { type: "stand", playerId });
  };

  const scheduleForfeit = (playerId: string): void => {
    const existing = graceTimers.get(playerId);
    if (existing) clearTimeout(existing);
    graceTimers.set(
      playerId,
      setTimeout(() => {
        graceTimers.delete(playerId);
        stand(playerId);
      }, deps.graceMs),
    );
  };

  const cancelForfeit = (playerId: string): void => {
    const timer = graceTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      graceTimers.delete(playerId);
    }
  };

  const currentSnapshot = (tableId: string): BoardUpdatePayload | null => {
    const table = tables.get(tableId);
    return table ? snapshot(tableId, table) : null;
  };

  const settle = async (): Promise<void> => {
    await Promise.all([...tables.values()].map((table) => table.queue));
  };

  // Pre-create runtimes so join-time sync has a snapshot for every table.
  for (const { id } of BOARD_TABLES) runtime(id);

  return { dispatch, stand, scheduleForfeit, cancelForfeit, currentSnapshot, settle };
}
