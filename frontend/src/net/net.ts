/**
 * Network abstraction. Game + React talk to this, never to socket.io directly.
 * Two implementations: RealNet (Socket.IO) and MockNet (in-browser simulation so
 * the frontend runs standalone in development).
 *
 * The JWT is sent in the Socket.IO handshake (`auth: { token }`); `join` carries
 * only `{ spaceId }`. Mock mode is development-only (see ./config).
 */
import { io, type Socket } from "socket.io-client";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  SERVER_EVENT_NAMES,
  gameForTable,
  rulesFor,
  type BoardGame,
  type BoardState,
  type BoardTableId,
  type BoardUpdatePayload,
  type ClientToServerEvents,
  type Dir,
  type InitPayload,
  type PlayerState,
  type ServerToClientEvents,
} from "@metaverse/shared";
import { USE_MOCK, assertServerUrl } from "./config";

type Listener<T> = (payload: T) => void;

export interface Net {
  connect(token: string, spaceId: string): void;
  on<T = unknown>(event: string, cb: (payload: T) => void): () => void;
  move(x: number, y: number, dir: Dir): void;
  chat(text: string, scope?: "world" | "room"): void;
  whisper(to: string, text: string): void;
  knock(roomId: string): void;
  cancelKnock(roomId: string): void;
  approveKnock(roomId: string, playerId: string): void;
  denyKnock(roomId: string, playerId: string): void;
  toggleAllowAll(roomId: string, allowAll: boolean): void;
  leaveRoom(): void;
  sit(roomId: string, seatId: number): void;
  stand(): void;
  meetingChat(text: string): void;
  boardSit(tableId: string, seat: number): void;
  boardStand(): void;
  boardAccept(tableId: string): void;
  boardMove(tableId: string, index: number): void;
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
export class RealNet implements Net {
  // Typed against the shared contract: emits are checked against the payload
  // schemas' inferred types, so a client/server drift is a compile error.
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private bus = new Emitter();
  private spaceId = "";
  selfId = "";

  constructor(url: string) {
    this.socket = io(url, { autoConnect: false, transports: ["websocket"] });

    for (const ev of SERVER_EVENT_NAMES) {
      // Forward every server → client event onto the internal bus untouched;
      // subscribers cast to the payload type they expect. The listener is cast
      // because `ev` is a union of event names here.
      this.socket.on(ev, ((p: unknown) => {
        if (ev === SERVER_EVENTS.init) this.selfId = (p as InitPayload).selfId;
        this.bus.emit(ev, p);
      }) as never);
    }

    // JWT validated in the handshake; (re)send join on every (re)connect. The
    // lifecycle events below are surfaced raw on the bus so the connection-state
    // machine (game/connectionState.ts) can render a truthful status — a
    // recovered reconnect is distinguished via socket.recovered.
    this.socket.on("connect", () => {
      if (this.spaceId) this.socket.emit(CLIENT_EVENTS.join, { spaceId: this.spaceId });
      this.bus.emit("socket-connect", { recovered: this.socket.recovered });
    });
    this.socket.on("disconnect", (reason: string) =>
      this.bus.emit("socket-disconnect", { reason })
    );
    // Manager-level retry signal (fires before each reconnection attempt).
    this.socket.io.on("reconnect_attempt", (attempt: number) =>
      this.bus.emit("socket-reconnecting", { attempt })
    );
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
    this.socket.emit(CLIENT_EVENTS.move, { x, y, dir });
  }
  chat(text: string, scope?: "world" | "room") {
    this.socket.emit(CLIENT_EVENTS.chat, { text, ...(scope ? { scope } : {}) });
  }
  whisper(to: string, text: string) {
    this.socket.emit(CLIENT_EVENTS.whisper, { to, text });
  }
  knock(roomId: string) {
    this.socket.emit(CLIENT_EVENTS.knock, { roomId });
  }
  cancelKnock(roomId: string) {
    this.socket.emit(CLIENT_EVENTS.cancelKnock, { roomId });
  }
  approveKnock(roomId: string, playerId: string) {
    this.socket.emit(CLIENT_EVENTS.approveKnock, { roomId, playerId });
  }
  denyKnock(roomId: string, playerId: string) {
    this.socket.emit(CLIENT_EVENTS.denyKnock, { roomId, playerId });
  }
  toggleAllowAll(roomId: string, allowAll: boolean) {
    this.socket.emit(CLIENT_EVENTS.toggleAllowAll, { roomId, allowAll });
  }
  leaveRoom() {
    this.socket.emit(CLIENT_EVENTS.roomLeave);
  }
  sit(roomId: string, seatId: number) {
    this.socket.emit(CLIENT_EVENTS.seatSit, { roomId, seatId });
  }
  stand() {
    this.socket.emit(CLIENT_EVENTS.seatStand);
  }
  meetingChat(text: string) {
    this.socket.emit(CLIENT_EVENTS.meetingChat, { text });
  }
  boardSit(tableId: string, seat: number) {
    this.socket.emit(CLIENT_EVENTS.boardSit, { tableId: tableId as BoardTableId, seat });
  }
  boardStand() {
    this.socket.emit(CLIENT_EVENTS.boardStand);
  }
  boardAccept(tableId: string) {
    this.socket.emit(CLIENT_EVENTS.boardAccept, { tableId: tableId as BoardTableId });
  }
  boardMove(tableId: string, index: number) {
    this.socket.emit(CLIENT_EVENTS.boardMove, { tableId: tableId as BoardTableId, index });
  }
  disconnect() {
    this.socket.disconnect();
  }
}

/* ----------------------- Mock (standalone, dev only) ----------------------- */
const NAMES = ["Aanya", "Rohan", "Mei", "Diego"] as const;

export class MockNet implements Net {
  private bus = new Emitter();
  selfId = "me";
  private npcs: PlayerState[] = [];
  private timer?: number;
  private name = "You";
  /** Pending demo-knock timer, so leaving a room clears it. */
  private knockDemoTimer?: number;

  connect() {
    // a few wandering NPCs around the plaza
    this.npcs = [
      { id: "npc1", name: NAMES[0], x: 360, y: 460, dir: "down" },
      { id: "npc2", name: NAMES[1], x: 440, y: 500, dir: "down" },
      { id: "npc3", name: NAMES[2], x: 300, y: 540, dir: "down" },
    ];
    setTimeout(() => {
      this.bus.emit(SERVER_EVENTS.init, {
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
      this.bus.emit(SERVER_EVENTS.playerMoved, { id: npc.id, x: npc.x, y: npc.y, dir });
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
    this.bus.emit(SERVER_EVENTS.chat, { id: this.selfId, name: this.name, text, scope: s, messageId: crypto.randomUUID(), ts: Date.now() });
    // a friendly NPC reply on the same channel
    setTimeout(
      () =>
        this.bus.emit(SERVER_EVENTS.chat, {
          id: "npc1",
          name: NAMES[0],
          text: "hey there!",
          scope: s,
          messageId: crypto.randomUUID(),
          ts: Date.now(),
        }),
      800
    );
  }
  whisper(to: string, text: string) {
    const target = this.npcs.find((n) => n.id === to);
    const toName = target?.name ?? "someone";
    // Mirror the server: echo the outgoing line back to the sender…
    this.bus.emit(SERVER_EVENTS.whisper, {
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
          this.bus.emit(SERVER_EVENTS.whisper, {
            from: target.id,
            fromName: target.name,
            to: this.selfId,
            toName: this.name,
            text: "(psst) got your whisper",
          }),
        900
      );
  }
  knock(roomId: string) {
    // Dev sandbox: you are always the first in, so you walk in as admin.
    this.bus.emit(SERVER_EVENTS.adminChanged, {
      roomId,
      admin: { id: this.selfId, name: this.name },
      reason: "initial",
    });
    this.bus.emit(SERVER_EVENTS.roomOpenState, { roomId, allowAll: false, atCapacity: false });
    this.bus.emit(SERVER_EVENTS.knockResult, { roomId, result: "approved" });
    // Fake a visitor knocking shortly after, so the approve/deny toast is testable.
    if (this.knockDemoTimer) clearTimeout(this.knockDemoTimer);
    this.knockDemoTimer = window.setTimeout(() => {
      this.bus.emit(SERVER_EVENTS.knockPending, { roomId, knocks: [{ id: "npc1", name: NAMES[0] }] });
    }, 2500);
  }
  cancelKnock() {
    /* you are the admin in the mock, never a pending knocker */
  }
  approveKnock(roomId: string) {
    this.bus.emit(SERVER_EVENTS.knockPending, { roomId, knocks: [] });
  }
  denyKnock(roomId: string) {
    this.bus.emit(SERVER_EVENTS.knockPending, { roomId, knocks: [] });
  }
  toggleAllowAll(roomId: string, allowAll: boolean) {
    this.bus.emit(SERVER_EVENTS.roomOpenState, { roomId, allowAll, atCapacity: false });
  }
  leaveRoom() {
    // no server in mock; the scene owns local room state
    if (this.knockDemoTimer) clearTimeout(this.knockDemoTimer);
  }
  sit(roomId: string, seatId: number) {
    this.bus.emit(SERVER_EVENTS.seatUpdate, { roomId, seatId, playerId: this.selfId });
  }
  stand() {
    /* seat freed handled by scene */
  }
  meetingChat(text: string) {
    // No real meetings in mock mode; echo the line back so the panel still
    // reflects your own message if it is ever mounted in a dev sandbox.
    this.bus.emit(SERVER_EVENTS.meetingChat, { roomId: "1", id: this.selfId, name: this.name, text });
  }

  /* --- Board tables: a local practice sandbox (you vs a random bot). --- */
  private boardTableId: string | null = null;
  private boardGame: BoardGame = "tictactoe";
  private boardSeat: 0 | 1 = 0;
  private boardState: BoardState | null = null;

  private emitBoard(phase: BoardUpdatePayload["phase"], reason: BoardUpdatePayload["reason"] = null) {
    if (!this.boardTableId) return;
    const me = { id: this.selfId, name: this.name, accepted: phase !== "offer" };
    const bot = { id: "practice-bot", name: "Practice Bot", accepted: phase !== "offer" };
    const seats: BoardUpdatePayload["seats"] = this.boardSeat === 0 ? [me, bot] : [bot, me];
    this.bus.emit(SERVER_EVENTS.boardUpdate, {
      tableId: this.boardTableId as BoardTableId,
      game: this.boardGame,
      phase,
      seats,
      state: phase === "active" || phase === "over" ? this.boardState : null,
      reason,
    });
  }
  private botMark(): 1 | 2 {
    return this.boardSeat === 0 ? 2 : 1;
  }
  private botTurn() {
    if (!this.boardState || this.boardState.result.status !== "in_progress") return;
    if (this.boardState.turn !== this.botMark()) return;
    const rules = rulesFor(this.boardGame);
    const legal: number[] = [];
    for (let i = 0; i < 42; i += 1) if (rules.applyMove(this.boardState, this.botMark(), i).ok) legal.push(i);
    const pick = legal[Math.floor(Math.random() * legal.length)];
    if (pick === undefined) return;
    setTimeout(() => {
      if (!this.boardState) return;
      const out = rules.applyMove(this.boardState, this.botMark(), pick);
      if (!out.ok) return;
      this.boardState = out.state;
      const done = out.state.result.status !== "in_progress";
      this.emitBoard(done ? "over" : "active", done ? (out.state.result.status === "draw" ? "draw" : "win") : null);
    }, 500);
  }
  boardSit(tableId: string, seat: number) {
    this.boardTableId = tableId;
    this.boardGame = gameForTable(tableId) ?? "tictactoe";
    this.boardSeat = seat === 1 ? 1 : 0;
    this.boardState = null;
    this.emitBoard("offer");
  }
  boardAccept(tableId: string) {
    if (tableId !== this.boardTableId) return;
    this.boardState = rulesFor(this.boardGame).create();
    this.emitBoard("active");
    this.botTurn();
  }
  boardMove(tableId: string, index: number) {
    if (tableId !== this.boardTableId || !this.boardState) return;
    const myMark = this.boardSeat === 0 ? 1 : 2;
    const out = rulesFor(this.boardGame).applyMove(this.boardState, myMark, index);
    if (!out.ok) return;
    this.boardState = out.state;
    const done = out.state.result.status !== "in_progress";
    this.emitBoard(done ? "over" : "active", done ? (out.state.result.status === "draw" ? "draw" : "win") : null);
    if (!done) this.botTurn();
  }
  boardStand() {
    this.boardTableId = null;
    this.boardState = null;
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
