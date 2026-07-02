/**
 * Network abstraction. Game + React talk to this, never to socket.io directly.
 * Two implementations: RealNet (Socket.IO) and MockNet (in-browser simulation so
 * the frontend runs standalone in development).
 *
 * The JWT is sent in the Socket.IO handshake (`auth: { token }`); `join` carries
 * only `{ spaceId }`. Mock mode is development-only (see ./config).
 */
import { io, type Socket } from "socket.io-client";
import type { Dir, PlayerState } from "../contract";
import { USE_MOCK, assertServerUrl } from "./config";

type Listener<T> = (payload: T) => void;

export interface Net {
  connect(token: string, spaceId: string): void;
  on<T = unknown>(event: string, cb: (payload: T) => void): () => void;
  move(x: number, y: number, dir: Dir): void;
  chat(text: string, scope?: "world" | "room"): void;
  whisper(to: string, text: string): void;
  enterRoom(roomId: string, key: string): void;
  leaveRoom(): void;
  sit(roomId: string, seatId: number): void;
  stand(): void;
  selfId: string;
  disconnect(): void;
}

class Emitter {
  private map = new Map<string, Set<Listener<never>>>();
  on<T = unknown>(event: string, cb: Listener<T>): () => void {
    const set = this.map.get(event) ?? new Set<Listener<never>>();
    this.map.set(event, set);
    set.add(cb as Listener<never>);
    return () => {
      set.delete(cb as Listener<never>);
    };
  }
  emit<T = unknown>(event: string, payload?: T): void {
    this.map.get(event)?.forEach((cb) => (cb as Listener<T>)(payload as T));
  }
}

/* ----------------------- Real (Socket.IO) ----------------------- */
const FORWARDED = [
  "init",
  "player-joined",
  "player-moved",
  "player-left",
  "chat",
  "whisper",
  "whisper-fail",
  "room-enter-result",
  "seat-update",
] as const;

export class RealNet implements Net {
  private socket: Socket;
  private bus = new Emitter();
  private spaceId = "";
  selfId = "";

  constructor(url: string) {
    this.socket = io(url, { autoConnect: false, transports: ["websocket"] });

    for (const ev of FORWARDED) {
      this.socket.on(ev, (p: unknown) => {
        if (ev === "init") this.selfId = (p as { selfId: string }).selfId;
        this.bus.emit(ev, p);
      });
    }

    // JWT validated in the handshake; (re)send join on every (re)connect.
    this.socket.on("connect", () => {
      if (this.spaceId) this.socket.emit("join", { spaceId: this.spaceId });
    });
    // Handshake rejection / network failure → surface so the UI can sign out.
    this.socket.on("connect_error", (err: Error) =>
      this.bus.emit("connect_error", { message: err.message })
    );
  }

  connect(token: string, spaceId: string) {
    this.spaceId = spaceId;
    this.socket.auth = { token }; // JWT in handshake, not in `join`
    this.socket.connect();
  }
  on<T = unknown>(event: string, cb: (payload: T) => void) {
    return this.bus.on(event, cb);
  }
  move(x: number, y: number, dir: Dir) {
    this.socket.emit("move", { x, y, dir });
  }
  chat(text: string, scope?: "world" | "room") {
    this.socket.emit("chat", { text, scope });
  }
  whisper(to: string, text: string) {
    this.socket.emit("whisper", { to, text });
  }
  enterRoom(roomId: string, key: string) {
    this.socket.emit("room-enter", { roomId, key });
  }
  leaveRoom() {
    this.socket.emit("room-leave");
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

/* ----------------------- Mock (standalone, dev only) ----------------------- */
const NAMES = ["Aanya", "Rohan", "Mei", "Diego"] as const;
const ROOM_KEYS: Record<string, string> = { "1": "1234", "2": "4321", "3": "3333" };

export class MockNet implements Net {
  private bus = new Emitter();
  selfId = "me";
  private npcs: PlayerState[] = [];
  private timer?: number;
  private name = "You";

  connect() {
    // a few wandering NPCs around the plaza
    this.npcs = [
      { id: "npc1", name: NAMES[0], x: 360, y: 460, dir: "down" },
      { id: "npc2", name: NAMES[1], x: 440, y: 500, dir: "down" },
      { id: "npc3", name: NAMES[2], x: 300, y: 540, dir: "down" },
    ];
    setTimeout(() => {
      this.bus.emit("init", {
        selfId: this.selfId,
        players: [
          { id: this.selfId, name: this.name, x: 384, y: 480, dir: "down" },
          ...this.npcs,
        ],
      });
    }, 100);
    this.timer = window.setInterval(() => this.wander(), 700);
  }
  private wander() {
    for (const npc of this.npcs) {
      const dirs: Dir[] = ["down", "left", "right", "up"];
      const dir = dirs[Math.floor(Math.random() * 4)] ?? "down";
      const step = 16;
      if (dir === "left") npc.x -= step;
      else if (dir === "right") npc.x += step;
      else if (dir === "up") npc.y -= step;
      else npc.y += step;
      // keep them roaming the open central band (mock has no collisions)
      npc.x = Math.max(48, Math.min(1000, npc.x));
      npc.y = Math.max(280, Math.min(820, npc.y));
      npc.dir = dir;
      this.bus.emit("player-moved", { id: npc.id, x: npc.x, y: npc.y, dir });
    }
  }
  on<T = unknown>(event: string, cb: (payload: T) => void) {
    return this.bus.on(event, cb);
  }
  move() {
    /* local player; nothing to echo in mock */
  }
  chat(text: string, scope?: "world" | "room") {
    const s = scope === "room" ? "room" : "world";
    this.bus.emit("chat", { id: this.selfId, name: this.name, text, scope: s });
    // a friendly NPC reply on the same channel
    setTimeout(
      () =>
        this.bus.emit("chat", {
          id: "npc1",
          name: NAMES[0],
          text: "hey! 👋",
          scope: s,
        }),
      800
    );
  }
  whisper(to: string, text: string) {
    const target = this.npcs.find((n) => n.id === to);
    const toName = target?.name ?? "someone";
    // Mirror the server: echo the outgoing line back to the sender…
    this.bus.emit("whisper", {
      from: this.selfId,
      fromName: this.name,
      to,
      toName,
      text,
    });
    // …then a private reply from the target.
    if (target)
      setTimeout(
        () =>
          this.bus.emit("whisper", {
            from: target.id,
            fromName: target.name,
            to: this.selfId,
            toName: this.name,
            text: "(psst) got your whisper 🤫",
          }),
        900
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
  leaveRoom() {
    /* no server in mock; the scene owns local room state */
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
  if (USE_MOCK) return new MockNet();
  // Production / real mode: a backend URL is mandatory (throws if missing).
  return new RealNet(assertServerUrl());
}

/** Mock room keys, surfaced so the dev UI can hint them. */
export const MOCK_ROOM_KEYS = ROOM_KEYS;
