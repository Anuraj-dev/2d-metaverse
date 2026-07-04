// Wire-contract types come from the shared package (the single source of truth for
// every socket/REST payload shape). This module re-exports the ones backend code
// consumes and adds SocketData, which is server-only per-connection state — not a
// wire shape, so it stays here.
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
}
