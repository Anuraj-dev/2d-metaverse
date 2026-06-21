/**
 * Network abstraction. Game + React talk to this, never to socket.io directly.
 * Two implementations: RealNet (Socket.IO, for Codex's backend) and MockNet
 * (in-browser simulation so the frontend runs standalone).
 * Switch with VITE_USE_MOCK ("1" = mock, default mock until backend is ready).
 */
import { io, Socket } from "socket.io-client";
import type { Dir, PlayerState } from "../contract";

type Handler = (payload: any) => void;

export interface Net {
  connect(token: string, spaceId: string): void;
  on(event: string, cb: Handler): () => void;
  move(x: number, y: number, dir: Dir): void;
  chat(text: string): void;
  enterRoom(roomId: string, key: string): void;
  sit(roomId: string, seatId: number): void;
  stand(): void;
  selfId: string;
  disconnect(): void;
}

class Emitter {
  private map = new Map<string, Set<Handler>>();
  on(event: string, cb: Handler) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(cb);
    return () => this.map.get(event)!.delete(cb);
  }
  emit(event: string, payload: any) {
    this.map.get(event)?.forEach((cb) => cb(payload));
  }
}

/* ----------------------- Real (Socket.IO) ----------------------- */
class RealNet implements Net {
  private socket: Socket;
  private bus = new Emitter();
  selfId = "";
  constructor(url: string) {
    this.socket = io(url, { autoConnect: false, transports: ["websocket"] });
    const forward = [
      "init",
      "player-joined",
      "player-moved",
      "player-left",
      "chat",
      "room-enter-result",
      "seat-update",
    ];
    forward.forEach((ev) =>
      this.socket.on(ev, (p: any) => {
        if (ev === "init") this.selfId = p.selfId;
        this.bus.emit(ev, p);
      })
    );
  }
  connect(token: string, spaceId: string) {
    this.socket.connect();
    this.socket.emit("join", { token, spaceId });
  }
  on(event: string, cb: Handler) {
    return this.bus.on(event, cb);
  }
  move(x: number, y: number, dir: Dir) {
    this.socket.emit("move", { x, y, dir });
  }
  chat(text: string) {
    this.socket.emit("chat", { text });
  }
  enterRoom(roomId: string, key: string) {
    this.socket.emit("room-enter", { roomId, key });
  }
  sit(roomId: string, seatId: number) {
    this.socket.emit("seat-sit", { roomId, seatId });
  }
  stand() {
    this.socket.emit("seat-stand");
  }
  disconnect() {
    this.socket.disconnect();
  }
}

/* ----------------------- Mock (standalone) ----------------------- */
const NAMES = ["Aanya", "Rohan", "Mei", "Diego"];
const ROOM_KEYS: Record<string, string> = { "1": "1234", "2": "4321" };

export class MockNet implements Net {
  private bus = new Emitter();
  selfId = "me";
  private npcs: PlayerState[] = [];
  private timer?: number;
  private name = "You";

  connect(_token: string, _spaceId: string) {
    // two wandering NPCs near the lounge
    this.npcs = [
      { id: "npc1", name: NAMES[0], x: 300, y: 300, dir: "down" },
      { id: "npc2", name: NAMES[1], x: 360, y: 320, dir: "down" },
    ];
    setTimeout(() => {
      this.bus.emit("init", {
        selfId: this.selfId,
        players: [
          { id: this.selfId, name: this.name, x: 320, y: 288, dir: "down" },
          ...this.npcs,
        ],
      });
    }, 100);
    this.timer = window.setInterval(() => this.wander(), 700);
  }
  private wander() {
    for (const npc of this.npcs) {
      const dirs: Dir[] = ["down", "left", "right", "up"];
      const dir = dirs[Math.floor(Math.random() * 4)];
      const step = 16;
      if (dir === "left") npc.x -= step;
      else if (dir === "right") npc.x += step;
      else if (dir === "up") npc.y -= step;
      else npc.y += step;
      npc.x = Math.max(32, Math.min(600, npc.x));
      npc.y = Math.max(180, Math.min(380, npc.y));
      npc.dir = dir;
      this.bus.emit("player-moved", { id: npc.id, x: npc.x, y: npc.y, dir });
    }
  }
  on(event: string, cb: Handler) {
    return this.bus.on(event, cb);
  }
  move(_x: number, _y: number, _dir: Dir) {
    /* local player; nothing to echo in mock */
  }
  chat(text: string) {
    this.bus.emit("chat", {
      id: this.selfId,
      name: this.name,
      text,
      scope: "world",
    });
    // a friendly NPC reply
    setTimeout(
      () =>
        this.bus.emit("chat", {
          id: "npc1",
          name: NAMES[0],
          text: "hey! 👋",
          scope: "world",
        }),
      800
    );
  }
  enterRoom(roomId: string, key: string) {
    const ok = ROOM_KEYS[roomId] === key;
    this.bus.emit("room-enter-result", {
      ok,
      roomId,
      reason: ok ? undefined : "bad-key",
    });
  }
  sit(roomId: string, seatId: number) {
    this.bus.emit("seat-update", { roomId, seatId, playerId: this.selfId });
  }
  stand() {
    /* seat freed handled by scene */
  }
  disconnect() {
    if (this.timer) clearInterval(this.timer);
  }
}

export function createNet(): Net {
  const useMock = (import.meta.env.VITE_USE_MOCK ?? "1") !== "0";
  if (useMock) return new MockNet();
  const url = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
  return new RealNet(url);
}

/** Mock room keys, surfaced so the dev UI can hint them. */
export const MOCK_ROOM_KEYS = ROOM_KEYS;
