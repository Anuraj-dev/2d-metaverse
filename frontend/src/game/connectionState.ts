/**
 * Pure connection-state + presence-convergence logic (PRD 25.5).
 *
 * Two concerns, both plain values in / plain values out (no Phaser / net / DOM):
 *
 *  1. `connectionReduce` — a tiny state machine turning raw socket.io lifecycle
 *     events into a truthful, user-facing connection status. The glue (App.tsx)
 *     feeds it socket events and renders the status; it never invents the status.
 *
 *  2. `reconcilePresence` — given the remotes we currently track and an
 *     authoritative `init` snapshot, computes the add/remove/update diff so a
 *     post-recovery re-emitted `init` (server contract from #139) can fully
 *     converge: remotes that left while we were disconnected are removed, not
 *     left as ghosts, and survivors are re-snapped to their true positions.
 */
import type { PlayerState } from "@metaverse/shared";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "recovered"
  | "gone";

export const CONNECTION_INITIAL: ConnectionStatus = "connecting";

/** How long the glue keeps the "recovered" acknowledgement up before settling. */
export const RECOVERED_NOTICE_MS = 3000;

export type ConnectionEvent =
  | { type: "connect"; recovered: boolean }
  | { type: "disconnect"; reason: string }
  | { type: "reconnecting" }
  | { type: "init" }
  | { type: "settle" };

/**
 * socket.io disconnect reasons that will NOT auto-reconnect — the link is truly
 * gone until something manually reconnects. Everything else (ping timeout,
 * transport close/error) is a transient drop the manager retries.
 */
const TERMINAL_DISCONNECT_REASONS: ReadonlySet<string> = new Set([
  "io server disconnect",
  "io client disconnect",
]);

export function connectionReduce(status: ConnectionStatus, event: ConnectionEvent): ConnectionStatus {
  switch (event.type) {
    case "connect":
      // A recovered connect restored the session — acknowledge it distinctly so
      // the user sees convergence happened; a plain connect is just "connected".
      return event.recovered ? "recovered" : "connected";
    case "disconnect":
      return TERMINAL_DISCONNECT_REASONS.has(event.reason) ? "gone" : "reconnecting";
    case "reconnecting":
      // The manager is retrying. Never resurrect a terminally-gone socket from a
      // stray retry signal — only a real connect may leave "gone".
      return status === "gone" ? "gone" : "reconnecting";
    case "init":
      // The authoritative snapshot means we have a live link. It is ALSO the
      // presence-reconciliation trigger, so while showing the "recovered"
      // acknowledgement we keep it up (a timed `settle` clears that) rather than
      // letting the immediately-following re-emitted init erase it.
      return status === "recovered" ? "recovered" : "connected";
    case "settle":
      return status === "recovered" ? "connected" : status;
  }
}

/** Does the client actually hold an authoritative link right now? */
export function isLive(status: ConnectionStatus): boolean {
  return status === "connected" || status === "recovered";
}

export interface PresenceDiff {
  /** In the snapshot, not yet tracked — create these remotes. */
  add: PlayerState[];
  /** Tracked, but absent from the snapshot — destroy these remotes (stale). */
  remove: string[];
  /** Tracked and still present — re-snap to the snapshot's authoritative pose. */
  update: PlayerState[];
}

/**
 * Diff the currently-tracked remote ids against an authoritative player snapshot.
 * `self` is excluded from every bucket — it is never a remote. Deterministic and
 * order-stable (add/update follow snapshot order; remove follows `known` order).
 */
export function reconcilePresence(
  known: Iterable<string>,
  snapshot: readonly PlayerState[],
  self: string,
): PresenceDiff {
  const knownIds = new Set(known);
  const add: PlayerState[] = [];
  const update: PlayerState[] = [];
  const seen = new Set<string>();

  for (const player of snapshot) {
    if (player.id === self) continue;
    seen.add(player.id);
    if (knownIds.has(player.id)) update.push(player);
    else add.push(player);
  }

  const remove: string[] = [];
  for (const id of knownIds) {
    if (id !== self && !seen.has(id)) remove.push(id);
  }

  return { add, remove, update };
}
