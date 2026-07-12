import { describe, it, expect } from "vitest";
import type { ConnectionStatus } from "./connectionState";
import type { MediaOutcomeStatus } from "../media/publicationState";
import {
  clampDuration,
  createOnceGuard,
  isRetryable,
  mediaEnableEvent,
  mediaEnableOutcome,
  reconnectEvent,
  reconnectOutcome,
  retryDelayMs,
  sessionStartEvent,
  worldLoadEvent,
} from "./reliability";

describe("clampDuration", () => {
  it("floors negatives and non-finite to 0 and caps at the 10-minute bound", () => {
    expect(clampDuration(-5)).toBe(0);
    expect(clampDuration(Number.NaN)).toBe(0);
    expect(clampDuration(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampDuration(1234.6)).toBe(1235);
    expect(clampDuration(10 * 60_000 + 1)).toBe(10 * 60_000);
  });
});

describe("reconnectOutcome transition matrix", () => {
  const cases: [ConnectionStatus, ConnectionStatus, ReturnType<typeof reconnectOutcome>][] = [
    ["connected", "reconnecting", "started"],
    ["connecting", "reconnecting", "started"],
    ["reconnecting", "reconnecting", null], // staying: no repeat "started"
    ["reconnecting", "recovered", "recovered"],
    ["reconnecting", "connected", "resumed"],
    ["reconnecting", "gone", "failed"],
    ["connecting", "connected", null], // plain first connect is not a reconnect
    ["connecting", "connecting", null],
    ["recovered", "connected", null], // settling after recovery is not "resumed"
    ["gone", "gone", null],
  ];
  it.each(cases)("%s -> %s = %s", (prev, next, expected) => {
    expect(reconnectOutcome(prev, next)).toBe(expected);
  });
});

describe("mediaEnableOutcome", () => {
  const cases: [MediaOutcomeStatus, string][] = [
    ["live", "success"],
    ["off", "success"],
    ["inactive", "success"],
    ["denied", "denied"],
    ["unavailable", "unavailable"],
    ["failed", "failed"],
  ];
  it.each(cases)("%s -> %s", (status, expected) => {
    expect(mediaEnableOutcome(status)).toBe(expected);
  });
});

describe("event builders produce bounded allowlisted shapes", () => {
  it("world-load clamps duration into the payload", () => {
    expect(worldLoadEvent("success", -1)).toEqual({
      name: "world-load",
      properties: { outcome: "success", durationMs: 0 },
    });
    expect(worldLoadEvent("failure", 5_000.4)).toEqual({
      name: "world-load",
      properties: { outcome: "failure", durationMs: 5_000 },
    });
  });
  it("reconnect / media-enable / session-start", () => {
    expect(reconnectEvent("failed")).toEqual({ name: "reconnect", properties: { outcome: "failed" } });
    expect(mediaEnableEvent("camera", "denied")).toEqual({
      name: "media-enable",
      properties: { kind: "camera", outcome: "denied" },
    });
    expect(sessionStartEvent()).toEqual({ name: "session-start", properties: {} });
  });
});

describe("createOnceGuard", () => {
  it("fires a key exactly once until reset", () => {
    const guard = createOnceGuard();
    expect(guard.fire("world-load")).toBe(true);
    expect(guard.fire("world-load")).toBe(false);
    expect(guard.fire("session-start")).toBe(true);
    guard.reset();
    expect(guard.fire("world-load")).toBe(true);
  });
});

describe("retry policy", () => {
  it("retries transient failures only", () => {
    expect(isRetryable({ kind: "network" })).toBe(true);
    expect(isRetryable({ kind: "http", status: 500 })).toBe(true);
    expect(isRetryable({ kind: "http", status: 503 })).toBe(true);
    expect(isRetryable({ kind: "http", status: 429 })).toBe(true);
    expect(isRetryable({ kind: "http", status: 202 })).toBe(false);
    expect(isRetryable({ kind: "http", status: 200 })).toBe(false);
    expect(isRetryable({ kind: "http", status: 400 })).toBe(false);
    expect(isRetryable({ kind: "http", status: 409 })).toBe(false);
  });
  it("backs off exponentially with a ceiling", () => {
    expect(retryDelayMs(1, 500, 5000)).toBe(500);
    expect(retryDelayMs(2, 500, 5000)).toBe(1000);
    expect(retryDelayMs(3, 500, 5000)).toBe(2000);
    expect(retryDelayMs(5, 500, 5000)).toBe(5000); // capped
  });
});
