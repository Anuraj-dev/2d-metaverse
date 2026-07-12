// Wire-contract types come from the shared package (the single source of truth for
// every socket/REST payload shape). This module re-exports the ones backend code
// consumes and adds SocketData, which is server-only per-connection state — not a
// wire shape, so it stays here.
import type { Dir } from "@metaverse/shared";

export type {
  Dir,
  PlayerState,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@metaverse/shared";

export interface SocketData {
  userId?: string;
  username?: string;
  playerId?: string;
  spaceId?: string;
  currentRoomId?: string;
  /** The room this socket last knocked at, for withdrawing a pending knock on disconnect. */
  knockRoomId?: string;
  lastMoveAt?: number;
  /** Last position the authoritative movement envelope accepted, with the ms it
   *  was accepted at. The single source of truth for anti-teleport correction. */
  moveAnchor?: { x: number; y: number; dir: Dir; at: number };
  /** When set, the next `move` re-anchors the envelope instead of speed-checking
   *  it — set on join and connection recovery (the client may have kept walking
   *  while its buffered moves were held). */
  moveJustEntered?: boolean;
}
