/**
 * Shared frontend <-> backend contract.
 * Codex: mirror these names/payloads exactly on the Socket.IO + REST server.
 * Any change here is a JOINT change.
 */

export type Dir = "down" | "left" | "right" | "up";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: Dir;
}

/* ---- Socket.IO: client -> server ---- */
export interface ClientToServer {
  join: (p: { token: string; spaceId: string }) => void;
  move: (p: { x: number; y: number; dir: Dir }) => void;
  chat: (p: { text: string }) => void;
  "room-enter": (p: { roomId: string; key: string }) => void;
  "seat-sit": (p: { roomId: string; seatId: number }) => void;
  "seat-stand": () => void;
}

/* ---- Socket.IO: server -> client ---- */
export interface ServerToClient {
  init: (p: { selfId: string; players: PlayerState[] }) => void;
  "player-joined": (p: PlayerState) => void;
  "player-moved": (p: { id: string; x: number; y: number; dir: Dir }) => void;
  "player-left": (p: { id: string }) => void;
  chat: (p: { id: string; name: string; text: string; scope: string }) => void;
  "room-enter-result": (p: {
    ok: boolean;
    roomId: string;
    reason?: "bad-key" | "full";
  }) => void;
  "seat-update": (p: {
    roomId: string;
    seatId: number;
    playerId: string | null;
  }) => void;
}

/* ---- REST ---- */
export interface SpaceInfo {
  mapJsonUrl: string;
  rooms: {
    id: string;
    name: string;
    doorZone: { x: number; y: number; width: number; height: number };
    seats: { id: number; x: number; y: number; facing: Dir }[];
  }[];
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  scope: string;
}
