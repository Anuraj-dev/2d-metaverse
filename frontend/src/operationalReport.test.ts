import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOperationalReport,
  createOperationalReporter,
  reconnectReason,
} from "./operationalReport";

describe("reconnectReason", () => {
  it("maps notable outcomes to a bounded reason", () => {
    expect(reconnectReason("reconnecting")).toBe("reconnecting");
    expect(reconnectReason("recovered")).toBe("recovered");
    expect(reconnectReason("gone")).toBe("gone");
  });
  it("returns null for healthy/transient-normal statuses", () => {
    expect(reconnectReason("connecting")).toBeNull();
    expect(reconnectReason("connected")).toBeNull();
  });
});

describe("buildOperationalReport", () => {
  const opts = { sha: "abc1234" };
  const loc = { pathname: "/space/1" };

  it("carries the category, reason, sha and a pathname-only url", () => {
    const report = buildOperationalReport("reconnect", "gone", opts, loc, "vitest-ua");
    expect(report).toMatchObject({ category: "reconnect", reason: "gone", sha: "abc1234", url: "/space/1", userAgent: "vitest-ua" });
    expect(report).not.toHaveProperty("context");
  });

  it("includes a bounded context note when provided, truncated to the cap", () => {
    const report = buildOperationalReport(
      "media-publish",
      "denied",
      { sha: "abc", getContext: () => "x".repeat(500) },
      loc,
      "ua"
    );
    expect(report.context).toBeDefined();
    expect(report.context!.length).toBe(200);
  });

  it("swallows a throwing getContext and omits context", () => {
    const report = buildOperationalReport(
      "auth-transport",
      "network",
      { sha: "abc", getContext: () => { throw new Error("hostile"); } },
      loc,
      "ua"
    );
    expect(report).not.toHaveProperty("context");
  });

  it("truncates over-long sha/userAgent to the caps", () => {
    const report = buildOperationalReport("reconnect", "gone", { sha: "s".repeat(100) }, loc, "u".repeat(400));
    expect(report.sha.length).toBe(64);
    expect(report.userAgent!.length).toBe(300);
  });
});

describe("createOperationalReporter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 } as Response));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { pathname: "/space/1" });
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "vitest" }, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = () => createOperationalReporter({ endpoint: "https://api.test/client-errors/operational", sha: "abc1234" });

  it("POSTs a bounded reconnect report to the operational endpoint", () => {
    make().reportReconnect("gone");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/client-errors/operational");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({ category: "reconnect", reason: "gone", sha: "abc1234" });
  });

  it("does not report a healthy reconnect status", () => {
    make().reportReconnect("connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dedupes identical category:reason within the window but sends distinct reasons", () => {
    const reporter = make();
    reporter.reportMediaPublishFailure("denied");
    reporter.reportMediaPublishFailure("denied"); // deduped
    reporter.reportMediaPublishFailure("failed"); // distinct reason
    reporter.reportAuthTransport("network"); // distinct category
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps the number of reports per session", () => {
    const reporter = createOperationalReporter({
      endpoint: "https://api.test/client-errors/operational",
      sha: "abc",
      maxPerSession: 2,
    });
    reporter.reportAuthTransport("unauthorized");
    reporter.reportAuthTransport("network");
    reporter.reportAuthTransport("server-error"); // over cap
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws even if fetch throws synchronously", () => {
    fetchMock.mockImplementation(() => { throw new Error("network down"); });
    const reporter = make();
    expect(() => reporter.reportReconnect("gone")).not.toThrow();
  });

  it("swallows a rejected fetch (fire-and-forget)", () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    const reporter = make();
    expect(() => reporter.reportMediaPublishFailure("failed")).not.toThrow();
  });
});
