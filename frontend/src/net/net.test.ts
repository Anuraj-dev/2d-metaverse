import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockNet, type Net } from "./net";

describe("MockNet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits init with self + NPCs on connect", () => {
    const net: Net = new MockNet();
    const seen: { selfId: string; players: unknown[] }[] = [];
    net.on<{ selfId: string; players: unknown[] }>("init", (p) => seen.push(p));
    net.connect("tok", "1");
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(1);
    const [init] = seen;
    if (!init) throw new Error("expected one init event");
    expect(init.selfId).toBe(net.selfId);
    expect(init.players.length).toBeGreaterThanOrEqual(2);
    net.disconnect();
  });

  it("echoes the sender's chat then an NPC reply", () => {
    const net: Net = new MockNet();
    const msgs: { name: string; text: string }[] = [];
    net.on<{ name: string; text: string }>("chat", (m) => msgs.push(m));
    net.connect("tok", "1");
    vi.advanceTimersByTime(200);
    net.chat("hello");
    const [firstMsg] = msgs;
    if (!firstMsg) throw new Error("expected the echoed chat message");
    expect(firstMsg.text).toBe("hello");
    vi.advanceTimersByTime(1000);
    expect(msgs.length).toBeGreaterThanOrEqual(2); // friendly NPC reply
    net.disconnect();
  });

  it("accepts the correct room key and rejects a wrong one", () => {
    const net: Net = new MockNet();
    const results: { ok: boolean; roomId: string; reason?: string }[] = [];
    net.on<{ ok: boolean; roomId: string; reason?: string }>(
      "room-enter-result",
      (r) => results.push(r)
    );
    net.connect("tok", "1");
    net.enterRoom("1", "1234");
    net.enterRoom("1", "nope");
    expect(results[0]).toMatchObject({ ok: true, roomId: "1" });
    expect(results[1]).toMatchObject({ ok: false, reason: "bad-key" });
    net.disconnect();
  });

  it("broadcasts NPC movement over time", () => {
    const net: Net = new MockNet();
    const moves: { id: string }[] = [];
    net.on<{ id: string }>("player-moved", (m) => moves.push(m));
    net.connect("tok", "1");
    vi.advanceTimersByTime(1500); // wander interval is 700ms
    expect(moves.length).toBeGreaterThan(0);
    net.disconnect();
  });
});
