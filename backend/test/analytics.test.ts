import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAnalyticsRetentionJob } from "../src/analytics-retention.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("analytics retention job", () => {
  it("prunes immediately and on schedule until stopped", async () => {
    vi.useFakeTimers();
    const prune = vi.fn(() => Promise.resolve(1));
    const job = startAnalyticsRetentionJob(pino({ enabled: false }), {
      intervalMs: 1_000,
      prune,
    });

    await vi.runOnlyPendingTimersAsync();
    expect(prune).toHaveBeenCalledTimes(2);

    job.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(prune).toHaveBeenCalledTimes(2);
  });
});
