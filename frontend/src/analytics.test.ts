import { describe, it, expect, vi } from "vitest";
import { createAnalyticsEmitter } from "./analytics";
import { sessionStartEvent, worldLoadEvent } from "./game/reliability";

const ENDPOINT = "https://api.test/api/v1/analytics/events";

interface Call {
  body: { eventId: string; event: unknown };
  auth: string | undefined;
}

/** A fetch double that returns a scripted status sequence and records calls. */
function scriptedFetch(statuses: (number | "network")[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      body: JSON.parse(String(init?.body)) as Call["body"],
      auth: headers.Authorization,
    });
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    if (status === "network") throw new Error("offline");
    return { status } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function emitter(fetchImpl: typeof fetch, overrides = {}) {
  return createAnalyticsEmitter({
    endpoint: ENDPOINT,
    getToken: () => "jwt-123",
    fetchImpl,
    generateId: () => "fixed-event-id",
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe("analytics emitter", () => {
  it("sends a bounded event with the bearer token and a client event id", async () => {
    const { impl, calls } = scriptedFetch([202]);
    emitter(impl).emit(sessionStartEvent());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.auth).toBe("Bearer jwt-123");
    expect(calls[0]?.body).toEqual({
      eventId: "fixed-event-id",
      event: { name: "session-start", properties: {} },
    });
  });

  it("retries a transient failure with the SAME event id, then stops on success", async () => {
    const { impl, calls } = scriptedFetch(["network", 503, 202]);
    emitter(impl).emit(worldLoadEvent("success", 1200));
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    // One id for the whole retry chain, so the server dedupes the replays.
    expect(new Set(calls.map((c) => c.body.eventId)).size).toBe(1);
    expect(calls[0]?.body.eventId).toBe("fixed-event-id");
    // No further attempts once the 202 lands.
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(3);
  });

  it("does not retry a duplicate acknowledgement (200) or a permanent 4xx", async () => {
    const dup = scriptedFetch([200]);
    emitter(dup.impl).emit(sessionStartEvent());
    await vi.waitFor(() => expect(dup.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 5));
    expect(dup.calls).toHaveLength(1);

    const conflict = scriptedFetch([409]);
    emitter(conflict.impl).emit(sessionStartEvent());
    await vi.waitFor(() => expect(conflict.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 5));
    expect(conflict.calls).toHaveLength(1);
  });

  it("gives up after maxAttempts on a persistent failure", async () => {
    const { impl, calls } = scriptedFetch(["network"]);
    emitter(impl, { maxAttempts: 3 }).emit(sessionStartEvent());
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(3);
  });

  it("emitOnce suppresses duplicate logical emissions per key", async () => {
    const { impl, calls } = scriptedFetch([202]);
    const e = emitter(impl);
    e.emitOnce("world-load", worldLoadEvent("success", 10));
    e.emitOnce("world-load", worldLoadEvent("success", 20));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(1);
  });

  it("never throws when the transport is broken (fire-and-forget)", () => {
    const broken = (() => {
      throw new Error("fetch exploded");
    }) as unknown as typeof fetch;
    expect(() => emitter(broken).emit(sessionStartEvent())).not.toThrow();
  });
});
