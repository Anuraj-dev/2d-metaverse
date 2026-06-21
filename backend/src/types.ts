export type Dir = "down" | "left" | "right" | "up";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: Dir;
}

export interface ClientToServerEvents {
  join: (payload: { spaceId: string }) => void;
  move: (payload: { x: number; y: number; dir: Dir }) => void;
  chat: (payload: { text: string }) => void;
  "room-enter": (payload: { roomId: string; key: string }) => void;
  "room-leave": () => void;
  "seat-sit": (payload: { roomId: string; seatId: number }) => void;
  "seat-stand": () => void;
}

export interface ServerToClientEvents {
  init: (payload: { selfId: string; players: PlayerState[] }) => void;
  "player-joined": (payload: PlayerState) => void;
  "player-moved": (payload: { id: string; x: number; y: number; dir: Dir }) => void;
  "player-left": (payload: { id: string }) => void;
  chat: (payload: { id: string; name: string; text: string; scope: string }) => void;
  "room-enter-result": (payload: { ok: boolean; roomId: string; reason?: "bad-key" | "full" | "rate-limited" }) => void;
  "seat-update": (payload: { roomId: string; seatId: number; playerId: string | null }) => void;
}

export interface SocketData {
  userId?: string;
  username?: string;
  playerId?: string;
  spaceId?: string;
  currentRoomId?: string;
  lastMoveAt?: number;
}
