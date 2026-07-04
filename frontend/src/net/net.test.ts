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

  it("admits a knock as admin and surfaces a later visitor's knock (PRD 14)", () => {
    const net: Net = new MockNet();
    const results: { roomId: string; result: string }[] = [];
    const admins: { admin: { id: string } | null }[] = [];
    const pending: { knocks: { id: string }[] }[] = [];
    net.on<{ roomId: string; result: string }>("knock-result", (r) => results.push(r));
    net.on<{ admin: { id: string } | null }>("admin-changed", (a) => admins.push(a));
    net.on<{ knocks: { id: string }[] }>("knock-pending", (p) => pending.push(p));
    net.connect("tok", "1");
    net.knock("1");
    // Immediate: you walk in as admin.
    expect(results[0]).toMatchObject({ roomId: "1", result: "approved" });
    expect(admins[0]?.admin?.id).toBe(net.selfId);
    // A demo visitor knocks after a beat; approving clears the queue.
    vi.advanceTimersByTime(2600);
    expect(pending.at(-1)?.knocks.length).toBe(1);
    net.approveKnock("1", "npc1");
    expect(pending.at(-1)?.knocks.length).toBe(0);
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
