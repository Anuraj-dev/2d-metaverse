/**
 * Side-effect shell around the pure board-match machine (boardMatch.ts). Owns
 * per-table machine state, the disconnect-grace timer, Redis persistence of the
 * live snapshot (with TTL), and the translation of machine effects into
 * space-scoped `board-update` broadcasts and per-client `board-error` replies.
 *
 * Every table is scoped by `(spaceId, tableId)`: board table ids (`ttt-1`, …) are
 * campus-map fixtures shared by every space running that map, so a match in one
 * space must be invisible to and independent of the same table in another. This
 * mirrors how meeting-manager.ts keys its runtimes by a space-unique room id.
 *
 * Dependencies are injected (name resolver, broadcaster, error sender, persister,
 * loader) so the manager stays unit-testable without Socket.IO or Redis; the
 * socket layer provides the real implementations.
 *
 * Dispatches are serialized per table: each table has its own promise queue so
 * two racing moves cannot interleave their transitions. On first touch after a
 * restart a table hydrates its state from the persisted Redis snapshot (respecting
 * the TTL) before applying, so live matches survive a backend restart.
 */
import {
  gameForTable,
  rulesFor,
  type BoardEndReason,
  type BoardOccupant,
  type BoardErrorPayload,
  type BoardGame,
  type BoardRules,
  type BoardUpdatePayload,
} from "@metaverse/shared";
import {
  IDLE_BOARD_MATCH,
  boardMatchTransition,
  seatOf,
  type BoardMatchEvent,
  type BoardMatchState,
  type Occupants,
} from "./boardMatch.js";
import type { Logger } from "pino";

export interface BoardManagerDeps {
  graceMs: number;
  ttlSeconds: number;
  resolveName: (playerId: string) => string;
  /** Broadcast a full snapshot to everyone in the space (seated + spectators). */
  broadcast: (spaceId: string, payload: BoardUpdatePayload) => void;
  /** Send a typed rejection to a single player. */
  sendError: (playerId: string, payload: BoardErrorPayload) => void;
  /** Persist (snapshot) or clear (null) the Redis mirror of a table. */
  persist: (spaceId: string, tableId: string, snapshot: BoardUpdatePayload | null) => void;
  /** Load a persisted snapshot for hydration, or null if none (TTL expired). */
  load: (spaceId: string, tableId: string) => Promise<BoardUpdatePayload | null>;
  log: Logger;
}

export interface BoardManager {
  /** Feed a table event; effects broadcast asynchronously. */
  dispatch: (spaceId: string, tableId: string, event: BoardMatchEvent) => void;
  /** Stand a player from every table they hold in the space (no-op if none). */
  stand: (spaceId: string, playerId: string) => void;
  /** On disconnect: after the grace window, stand the player from their tables. */
  scheduleForfeit: (spaceId: string, playerId: string) => void;
  /** On reconnect/rejoin: cancel a pending disconnect forfeit. */
  cancelForfeit: (playerId: string) => void;
  /** The current authoritative snapshot for a table (for join-time sync). */
  currentSnapshot: (spaceId: string, tableId: string) => Promise<BoardUpdatePayload | null>;
  /** Await all in-flight dispatches (test synchronization only). */
  settle: () => Promise<void>;
}

interface TableRuntime {
  spaceId: string;
  tableId: string;
  game: BoardGame;
  rules: BoardRules;
  state: BoardMatchState;
  /** Shared hydrate-once promise; set on first touch, awaited by all callers. */
  hydration?: Promise<void>;
}

/** Composite key for a table's runtime — a space id never contains a space char. */
const runtimeKey = (spaceId: string, tableId: string): string => `${spaceId} ${tableId}`;

export function createBoardManager(deps: BoardManagerDeps): BoardManager {
  const tables = new Map<string, TableRuntime>();
  const graceTimers = new Map<string, NodeJS.Timeout>();
  // ONE serialization queue per space for EVERY board operation in that space —
  // sit, accept, move, stand, disconnect-cleanup, and the hydration currentSnapshot
  // does. Board table ids are shared campus-map fixtures, but per-table queues are
  // not enough: the one-table-per-player invariant is a CROSS-table rule, and
  // splitting seat mutations from moves reorders a table's own events (a stand
  // could overtake an in-flight move) while out-of-queue hydration could restore a
  // stale occupant after a sit committed elsewhere (double-seat). Funneling all of
  // a space's board events through one queue gives total per-table order and makes
  // hydration + the invariant check + commit atomic within the space. Serializing
  // a space's few, instantaneous board transitions is free (meeting-manager keys
  // its runtimes per room the same way).
  const spaceQueues = new Map<string, Promise<unknown>>();

  const runtime = (spaceId: string, tableId: string): TableRuntime | undefined => {
    const mapKey = runtimeKey(spaceId, tableId);
    const existing = tables.get(mapKey);
    if (existing) return existing;
    const game = gameForTable(tableId);
    if (!game) return undefined;
    const table: TableRuntime = {
      spaceId,
      tableId,
      game,
      rules: rulesFor(game),
      state: IDLE_BOARD_MATCH,
    };
    tables.set(mapKey, table);
    return table;
  };

  /**
   * Serialize `op` on the space's single queue and return its result. The stored
   * tail swallows rejections so one failing op never poisons the queue; each
   * caller handles (logs) its own errors on the returned promise.
   */
  const enqueue = <T>(spaceId: string, op: () => Promise<T>): Promise<T> => {
    const tail = spaceQueues.get(spaceId) ?? Promise.resolve();
    const result = tail.then(op);
    spaceQueues.set(spaceId, result.then(() => undefined, () => undefined));
    return result;
  };

  const occupant = (state: BoardMatchState, seat: 0 | 1): BoardOccupant | null => {
    const id = state.occupants[seat];
    if (id === null) return null;
    const accepted = state.match.phase === "offer" ? state.match.accepted[seat] : state.match.phase !== "waiting";
    return { id, name: deps.resolveName(id), accepted };
  };

  const snapshot = (table: TableRuntime): BoardUpdatePayload => {
    const { state, game, tableId } = table;
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

  /** Rebuild a machine state from a persisted wire snapshot (restart recovery). */
  const reconstruct = (snap: BoardUpdatePayload): BoardMatchState => {
    const occupants: Occupants = [snap.seats[0]?.id ?? null, snap.seats[1]?.id ?? null];
    switch (snap.phase) {
      case "waiting":
        return { occupants, match: { phase: "waiting" } };
      case "offer":
        return {
          occupants,
          match: { phase: "offer", accepted: [snap.seats[0]?.accepted ?? false, snap.seats[1]?.accepted ?? false] },
        };
      case "active": {
        if (!snap.state) throw new Error(`hydrate: active table ${snap.tableId} has no game state`);
        return { occupants, match: { phase: "active", game: snap.state } };
      }
      case "over": {
        if (!snap.state || !snap.reason) throw new Error(`hydrate: over table ${snap.tableId} missing state/reason`);
        return { occupants, match: { phase: "over", game: snap.state, reason: snap.reason } };
      }
    }
  };

  /** Load persisted state once, before this table's first transition/access. */
  const ensureHydrated = (table: TableRuntime): Promise<void> => {
    table.hydration ??= (async () => {
      try {
        const snap = await deps.load(table.spaceId, table.tableId);
        // Only adopt persisted state if nothing has touched the table since — a
        // concurrent live event always wins over a stale restart snapshot.
        if (snap && isIdle(table.state)) table.state = reconstruct(snap);
      } catch (error: unknown) {
        deps.log.error({ err: error, spaceId: table.spaceId, tableId: table.tableId }, "board hydrate failed");
      }
    })();
    return table.hydration;
  };

  /** Every materialized table in `spaceId`. */
  const tablesInSpace = (spaceId: string): TableRuntime[] =>
    [...tables.values()].filter((t) => t.spaceId === spaceId);

  /** Every table in `spaceId` where `playerId` currently holds a seat. */
  const seatedTables = (spaceId: string, playerId: string): TableRuntime[] =>
    tablesInSpace(spaceId).filter((t) => seatOf(t.state.occupants, playerId) !== null);

  /**
   * Run a machine transition and emit its effects. SYNCHRONOUS: the caller (always
   * inside the space queue) must have hydrated the table first, so there is no
   * await between reading and committing `table.state`.
   */
  const applyTransition = (table: TableRuntime, event: BoardMatchEvent): void => {
    const { state, effects } = boardMatchTransition(table.state, event, table.rules);
    table.state = state;
    for (const effect of effects) {
      switch (effect.type) {
        case "changed": {
          const snap = snapshot(table);
          deps.broadcast(table.spaceId, snap);
          deps.persist(table.spaceId, table.tableId, isIdle(state) ? null : snap);
          break;
        }
        case "started":
          deps.log.info({ spaceId: table.spaceId, tableId: table.tableId, game: table.game }, "board match started");
          break;
        case "ended":
          deps.log.info({ spaceId: table.spaceId, tableId: table.tableId, reason: effect.reason }, "board match ended");
          break;
        case "rejected":
          deps.sendError(effect.playerId, {
            tableId: table.tableId as BoardErrorPayload["tableId"],
            reason: effect.reason,
          });
          break;
      }
    }
  };

  const dispatch = (spaceId: string, tableId: string, event: BoardMatchEvent): void => {
    // Every table event (sit / accept / move) runs on the space queue, preserving
    // total per-table order — B's queued move can never be reordered behind a stand.
    void enqueue(spaceId, async () => {
      const table = runtime(spaceId, tableId);
      if (!table) {
        deps.log.warn({ spaceId, tableId, event: event.type }, "board dispatch for unknown table");
        return;
      }
      await ensureHydrated(table);
      // One-table-per-player invariant: reject a sit when the player already holds
      // a seat at a DIFFERENT table in the space. Hydration, the check and the
      // commit are atomic because the whole space runs on this one queue.
      if (event.type === "sit" && seatedTables(spaceId, event.playerId).some((t) => t !== table)) {
        deps.sendError(event.playerId, { tableId: tableId as BoardErrorPayload["tableId"], reason: "seat-taken" });
        return;
      }
      applyTransition(table, event);
    }).catch((error: unknown) => deps.log.error({ err: error, spaceId, tableId, event }, "board dispatch failed"));
  };

  const stand = (spaceId: string, playerId: string): void => {
    // On the space queue, so a sit still queued behind hydration commits BEFORE
    // this cleanup runs and is always seen and cleaned up — no stranded seat, timer
    // or Redis key. Cleans up ALL the player's tables (belt-and-suspenders; the
    // invariant keeps it to one in practice).
    void enqueue(spaceId, async () => {
      await Promise.all(tablesInSpace(spaceId).map((t) => ensureHydrated(t)));
      for (const table of seatedTables(spaceId, playerId)) {
        applyTransition(table, { type: "stand", playerId });
      }
    }).catch((error: unknown) => deps.log.error({ err: error, spaceId, playerId }, "board cleanup failed"));
  };

  const scheduleForfeit = (spaceId: string, playerId: string): void => {
    const existing = graceTimers.get(playerId);
    if (existing) clearTimeout(existing);
    graceTimers.set(
      playerId,
      setTimeout(() => {
        graceTimers.delete(playerId);
        stand(spaceId, playerId);
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

  const currentSnapshot = (spaceId: string, tableId: string): Promise<BoardUpdatePayload | null> =>
    // On the space queue too: hydration mutates occupants, so ordering it with
    // sits/stands prevents a delayed restore from re-seating a player after they
    // committed a seat elsewhere.
    enqueue(spaceId, async () => {
      const table = runtime(spaceId, tableId);
      if (!table) return null;
      await ensureHydrated(table);
      return snapshot(table);
    });

  const settle = async (): Promise<void> => {
    await Promise.all([...spaceQueues.values()]);
  };

  return { dispatch, stand, scheduleForfeit, cancelForfeit, currentSnapshot, settle };
}
