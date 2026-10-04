import { describe, expect, it, vi } from "vitest";
import { createCoalescedRefresh } from "../src/coalesced-refresh.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => { throw new Error("resolver not initialized"); };
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("coalesced read-model refresh", () => {
  it("coalesces a burst and publishes the initial and latest state in order", async () => {
    const gate = deferred();
    let state = 1;
    const published: number[] = [];
    const refresh = vi.fn(async () => {
      const captured = state;
      if (captured === 1) await gate.promise;
      published.push(captured);
    });
    const request = createCoalescedRefresh(refresh, vi.fn());
    const done = request("space");
    await Promise.resolve();
    for (state = 2; state <= 100; state++) expect(request("space")).toBe(done);
    gate.resolve();
    await done;
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(published).toEqual([1, 101]);
  });

  it("refreshes independent spaces without blocking and releases idle entries", async () => {
    const gate = deferred();
    const refresh = vi.fn(async (key: string) => { if (key === "slow") await gate.promise; });
    const request = createCoalescedRefresh(refresh, vi.fn());
    const slow = request("slow");
    await request("fast");
    expect(refresh).toHaveBeenCalledWith("fast");
    const again = request("fast");
    await again;
    expect(refresh.mock.calls.filter(([key]) => key === "fast")).toHaveLength(2);
    gate.resolve();
    await slow;
  });

  it("reports a failure once without automatic retry, then allows a fresh request", async () => {
    const failure = new Error("database unavailable");
    const refresh = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();
    const request = createCoalescedRefresh(refresh, onError);
    await request("space");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "space");
    await request("space");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("preserves a pending follow-up when an in-flight pass fails", async () => {
    const gate = deferred();
    const refresh = vi.fn().mockImplementationOnce(async () => { await gate.promise; throw new Error("failed"); }).mockResolvedValue(undefined);
    const onError = vi.fn();
    const request = createCoalescedRefresh(refresh, onError);
    const done = request("space");
    await Promise.resolve();
    void request("space");
    gate.resolve();
    await done;
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("completes each pass during continuous activity without an unbounded queue", async () => {
    let passes = 0;
    let request: (key: string) => Promise<void> = () => Promise.resolve();
    request = createCoalescedRefresh(async (key: string) => {
      passes++;
      if (passes < 5) for (let i = 0; i < 20; i++) void request(key);
      await Promise.resolve();
    }, vi.fn());
    await request("space");
    expect(passes).toBe(5);
  });
});
