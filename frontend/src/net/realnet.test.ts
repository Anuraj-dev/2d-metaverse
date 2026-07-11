import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = (...args: unknown[]) => void;

// Shared socket double, defined before the mock factory runs.
const h = vi.hoisted(() => {
  const handlers: Record<string, Handler> = {};
  const managerHandlers: Record<string, Handler> = {};
  const socket = {
    auth: undefined as unknown,
    recovered: false,
    on: vi.fn((ev: string, cb: Handler) => {
      handlers[ev] = cb;
    }),
    // The Manager (socket.io) surface — reconnection attempts fire here.
    io: {
      on: vi.fn((ev: string, cb: Handler) => {
        managerHandlers[ev] = cb;
      }),
    },
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, managerHandlers, socket, io: vi.fn(() => socket) };
});

vi.mock("socket.io-client", () => ({ io: h.io, Socket: class {} }));

import { RealNet } from "./net";

beforeEach(() => {
  h.io.mockClear();
  h.socket.on.mockClear();
  h.socket.emit.mockClear();
  h.socket.connect.mockClear();
  h.socket.disconnect.mockClear();
  h.socket.io.on.mockClear();
  for (const k of Object.keys(h.handlers)) delete h.handlers[k];
  for (const k of Object.keys(h.managerHandlers)) delete h.managerHandlers[k];
  h.socket.auth = undefined;
  h.socket.recovered = false;
});

describe("RealNet adapter", () => {
  it("opens the socket with websocket transport and no autoConnect", () => {
    new RealNet("http://api.test");
    expect(h.io).toHaveBeenCalledWith("http://api.test", {
      autoConnect: false,
      transports: ["websocket"],
    });
  });

  it("sends the JWT in the handshake auth, never in join", () => {
    const net = new RealNet("http://api.test");
    net.connect("jwt-123", "space-1");

    expect(h.socket.auth).toEqual({ token: "jwt-123" });
    expect(h.socket.connect).toHaveBeenCalledTimes(1);
    // join is deferred until the socket actually connects
    expect(h.socket.emit).not.toHaveBeenCalled();

    h.handlers["connect"]?.();
    expect(h.socket.emit).toHaveBeenCalledWith("join", { spaceId: "space-1" });

    const joinCall = h.socket.emit.mock.calls.find((c) => c[0] === "join");
    expect(JSON.stringify(joinCall)).not.toContain("jwt-123");
  });

  it("emits room-leave when leaving a room", () => {
    const net = new RealNet("http://api.test");
    net.leaveRoom();
    expect(h.socket.emit).toHaveBeenCalledWith("room-leave");
  });

  it("surfaces connect_error to subscribers", () => {
    const net = new RealNet("http://api.test");
    const seen: { message: string }[] = [];
    net.on<{ message: string }>("connect_error", (p) => seen.push(p));

    h.handlers["connect_error"]?.(new Error("invalid token"));
    expect(seen).toEqual([{ message: "invalid token" }]);
  });

  it("surfaces socket lifecycle events for the connection-state machine", () => {
    const net = new RealNet("http://api.test");
    const connects: { recovered: boolean }[] = [];
    const disconnects: { reason: string }[] = [];
    const reconnecting: { attempt: number }[] = [];
    net.on<{ recovered: boolean }>("socket-connect", (p) => connects.push(p));
    net.on<{ reason: string }>("socket-disconnect", (p) => disconnects.push(p));
    net.on<{ attempt: number }>("socket-reconnecting", (p) => reconnecting.push(p));

    h.handlers["connect"]?.();
    expect(connects).toEqual([{ recovered: false }]);

    h.socket.recovered = true;
    h.handlers["connect"]?.();
    expect(connects).toEqual([{ recovered: false }, { recovered: true }]);

    h.managerHandlers["reconnect_attempt"]?.(2);
    expect(reconnecting).toEqual([{ attempt: 2 }]);

    h.handlers["disconnect"]?.("transport close");
    expect(disconnects).toEqual([{ reason: "transport close" }]);
  });

  it("captures selfId from init and forwards the payload", () => {
    const net = new RealNet("http://api.test");
    const seen: { selfId: string }[] = [];
    net.on<{ selfId: string }>("init", (p) => seen.push(p));

    h.handlers["init"]?.({ selfId: "me-42", players: [] });
    expect(net.selfId).toBe("me-42");
    const [init] = seen;
    if (!init) throw new Error("expected the forwarded init payload");
    expect(init.selfId).toBe("me-42");
  });
});
