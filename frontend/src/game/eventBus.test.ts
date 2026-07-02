import { describe, it, expect, vi } from "vitest";
import { bus } from "./eventBus";

/**
 * The event bus is the Phaser↔React contract seam — the same one the future E2E
 * suite hooks. These tests pin its subscribe / emit / unsubscribe semantics.
 */
describe("event bus", () => {
  it("delivers an emitted payload to a subscriber", () => {
    const seen: Array<{ roomId: string }> = [];
    const off = bus.on<{ roomId: string }>("test-near-door", (p) => seen.push(p));
    bus.emit("test-near-door", { roomId: "D" });
    off();
    expect(seen).toEqual([{ roomId: "D" }]);
  });

  it("fans out to multiple subscribers of the same event", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on("test-fanout", a);
    const offB = bus.on("test-fanout", b);
    bus.emit("test-fanout", 42);
    offA();
    offB();
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it("stops delivering after unsubscribe", () => {
    const cb = vi.fn();
    const off = bus.on("test-unsub", cb);
    bus.emit("test-unsub");
    off();
    bus.emit("test-unsub");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("isolates listeners across event names", () => {
    const cb = vi.fn();
    const off = bus.on("test-a", cb);
    bus.emit("test-b");
    off();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-ops when emitting an event with no listeners", () => {
    expect(() => bus.emit("test-nobody", { x: 1 })).not.toThrow();
  });

  it("unsubscribing one listener leaves the others attached", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on("test-partial", a);
    const offB = bus.on("test-partial", b);
    offA();
    bus.emit("test-partial");
    offB();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
