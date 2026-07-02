import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildPayload,
  createBeaconState,
  installErrorBeacon,
  recordSend,
  shouldSend,
} from "./errorBeacon";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("shouldSend", () => {
  it("allows a fresh message and blocks after the session cap", () => {
    const state = createBeaconState();
    const limits = { maxPerSession: 2, dedupeWindowMs: 30_000 };

    expect(shouldSend(state, "a", 0, limits)).toBe(true);
    recordSend(state, "a", 0);
    expect(shouldSend(state, "b", 1, limits)).toBe(true);
    recordSend(state, "b", 1);
    expect(shouldSend(state, "c", 2, limits)).toBe(false);
  });

  it("dedupes identical messages within the window and allows them after", () => {
    const state = createBeaconState();
    const limits = { maxPerSession: 10, dedupeWindowMs: 30_000 };

    recordSend(state, "same", 1_000);
    expect(shouldSend(state, "same", 20_000, limits)).toBe(false);
    expect(shouldSend(state, "different", 20_000, limits)).toBe(true);
    expect(shouldSend(state, "same", 31_001, limits)).toBe(true);
  });
});

describe("buildPayload", () => {
  it("builds the expected shape with sha, url, and userAgent", () => {
    const payload = buildPayload(
      "boom",
      "Error: boom\n  at x",
      { sha: "abc1234" },
      { pathname: "/world" },
      "test-agent",
    );
    expect(payload).toEqual({
      message: "boom",
      stack: "Error: boom\n  at x",
      sha: "abc1234",
      url: "/world",
      userAgent: "test-agent",
    });
  });

  it("truncates oversize fields to the backend schema caps", () => {
    const payload = buildPayload(
      "m".repeat(5000),
      "s".repeat(20_000),
      { sha: "x".repeat(100), getContext: () => "c".repeat(500) },
      { pathname: "/p".repeat(600) },
      "u".repeat(600),
    );
    expect(payload.message.length).toBe(2000);
    expect(payload.stack?.length).toBe(8000);
    expect(payload.sha.length).toBe(64);
    expect(payload.url?.length).toBe(500);
    expect(payload.userAgent?.length).toBe(300);
    expect(payload.context?.length).toBe(200);
  });

  it("swallows a throwing getContext", () => {
    const payload = buildPayload(
      "boom",
      undefined,
      {
        sha: "abc",
        getContext: () => {
          throw new Error("scene unavailable");
        },
      },
      { pathname: "/" },
      "ua",
    );
    expect(payload.context).toBeUndefined();
    expect(payload.message).toBe("boom");
  });
});

describe("installErrorBeacon", () => {
  // Keep vitest from reporting our synthetic ErrorEvents as uncaught exceptions.
  const suppress = (event: Event) => event.preventDefault();
  beforeEach(() => window.addEventListener("error", suppress));
  afterEach(() => window.removeEventListener("error", suppress));

  it("POSTs a payload on window error events", async () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc1234" });
    try {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "boom", error: new Error("boom") }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://api.test/client-errors");
      expect(init.method).toBe("POST");
      expect(init.keepalive).toBe(true);
      const body = JSON.parse(init.body as string);
      expect(body.message).toBe("boom");
      expect(body.sha).toBe("abc1234");
      expect(typeof body.stack).toBe("string");
    } finally {
      uninstall();
    }
  });

  it("POSTs on unhandled promise rejections", () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc1234" });
    try {
      const reason = new Error("rejected!");
      const event = new Event("unhandledrejection") as Event & {
        reason?: unknown;
        promise?: Promise<unknown>;
      };
      event.reason = reason;
      event.promise = Promise.resolve(); // pre-resolved stand-in; jsdom lacks PromiseRejectionEvent
      window.dispatchEvent(event);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.message).toBe("rejected!");
    } finally {
      uninstall();
    }
  });

  it("enforces the per-session cap and dedupe window", () => {
    const uninstall = installErrorBeacon({
      endpoint: "http://api.test/client-errors",
      sha: "abc",
      maxPerSession: 2,
      dedupeWindowMs: 60_000,
    });
    try {
      const fire = (message: string) =>
        window.dispatchEvent(new ErrorEvent("error", { message, error: new Error(message) }));
      fire("one");
      fire("one"); // deduped
      fire("two");
      fire("three"); // over session cap
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      uninstall();
    }
  });

  it("swallows fetch failures without throwing", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc" });
    try {
      expect(() =>
        window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new Error("boom") })),
      ).not.toThrow();
      // let the rejected fetch promise settle; an unhandled rejection would fail the test run
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
    }
  });

  const dispatchRejection = (reason: unknown) => {
    const event = new Event("unhandledrejection") as Event & {
      reason?: unknown;
      promise?: Promise<unknown>;
    };
    event.reason = reason;
    event.promise = Promise.resolve();
    window.dispatchEvent(event);
  };

  it("survives a rejection reason with a throwing toJSON and still sends a fallback payload", () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc" });
    try {
      expect(() =>
        dispatchRejection({
          toJSON() {
            throw new Error("toJSON bomb");
          },
        }),
      ).not.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.message).toBe("unhandled rejection: [unserializable]");
    } finally {
      uninstall();
    }
  });

  it("survives a rejection reason with throwing Symbol.toPrimitive and toString", () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc" });
    try {
      const hostile = {
        [Symbol.toPrimitive]() {
          throw new Error("toPrimitive bomb");
        },
        toString() {
          throw new Error("toString bomb");
        },
      };
      expect(() => dispatchRejection(hostile)).not.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      // JSON.stringify ignores Symbol.toPrimitive/toString (no own enumerable
      // props here), so the exact expected serialization is "{}" — the point
      // is that no string-coercion path ever invokes the throwing methods.
      expect(body.message).toBe("unhandled rejection: {}");
    } finally {
      uninstall();
    }
  });

  it("survives a revoked Proxy rejection reason (instanceof itself throws) and posts the fallback", () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc" });
    try {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expect(() => dispatchRejection(proxy)).not.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.message).toBe("unhandled rejection: [unserializable]");
      expect(body.stack).toBeUndefined();
    } finally {
      uninstall();
    }
  });

  it("survives a revoked Proxy as an error event's error and posts the fallback", () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc" });
    try {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expect(() =>
        window.dispatchEvent(new ErrorEvent("error", { error: proxy })),
      ).not.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.message).toBe("[unserializable]");
      expect(body.stack).toBeUndefined();
    } finally {
      uninstall();
    }
  });

  it("survives an Error subclass with throwing message/stack getters (rejection and error event)", () => {
    class EvilError extends Error {
      override get message(): string {
        throw new Error("message bomb");
      }
      override get stack(): string {
        throw new Error("stack bomb");
      }
    }
    const uninstall = installErrorBeacon({
      endpoint: "http://api.test/client-errors",
      sha: "abc",
      dedupeWindowMs: 0, // both dispatches produce the same fallback message
    });
    try {
      expect(() => dispatchRejection(new EvilError())).not.toThrow();
      expect(() =>
        window.dispatchEvent(new ErrorEvent("error", { error: new EvilError() })),
      ).not.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const first = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      const second = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
      expect(first.message).toBe("[unserializable]");
      expect(first.stack).toBeUndefined();
      expect(second.message).toBe("[unserializable]");
      expect(second.stack).toBeUndefined();
    } finally {
      uninstall();
    }
  });

  it("stops reporting after uninstall", () => {
    const uninstall = installErrorBeacon({ endpoint: "http://api.test/client-errors", sha: "abc" });
    uninstall();
    window.dispatchEvent(new ErrorEvent("error", { message: "late", error: new Error("late") }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
