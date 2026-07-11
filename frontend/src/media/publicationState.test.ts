import { describe, expect, it } from "vitest";
import {
  INITIAL_PUBLICATION,
  classifyMediaError,
  isPublishFailure,
  isPublishPending,
  isPublished,
  outcomeNeedsAttention,
  publicationReduce,
  worstOutcome,
  type MediaOutcome,
  type MediaOutcomeStatus,
  type MediaPublicationEvent,
  type MediaPublicationStatus,
} from "./publicationState";

/**
 * Transition matrix (incl. illegal transitions) for the pure publication-state
 * machine — the same table-driven style as connectionState.test.ts. The
 * load-bearing invariant is that `"live"` is reachable ONLY through the publish
 * pipeline and never from a resting failure/off.
 */
describe("publicationReduce", () => {
  it("starts off", () => {
    expect(INITIAL_PUBLICATION).toBe("off");
  });

  const cases: {
    from: MediaPublicationStatus;
    event: MediaPublicationEvent;
    to: MediaPublicationStatus;
  }[] = [
    // enable arms the pipeline only from a resting state
    { from: "off", event: { type: "enable" }, to: "pending" },
    { from: "denied", event: { type: "enable" }, to: "pending" },
    { from: "unavailable", event: { type: "enable" }, to: "pending" },
    { from: "failed", event: { type: "enable" }, to: "pending" },
    // enable is a no-op once the pipeline is already active
    { from: "pending", event: { type: "enable" }, to: "pending" },
    { from: "connecting", event: { type: "enable" }, to: "connecting" },
    { from: "publishing", event: { type: "enable" }, to: "publishing" },
    { from: "live", event: { type: "enable" }, to: "live" },
    { from: "reconnecting", event: { type: "enable" }, to: "reconnecting" },
    // the happy path
    { from: "pending", event: { type: "connecting" }, to: "connecting" },
    { from: "connecting", event: { type: "publishing" }, to: "publishing" },
    { from: "publishing", event: { type: "published" }, to: "live" },
    { from: "pending", event: { type: "published" }, to: "live" },
    { from: "reconnecting", event: { type: "published" }, to: "live" },
    // reconnect only from an active publish
    { from: "live", event: { type: "reconnecting" }, to: "reconnecting" },
    { from: "publishing", event: { type: "reconnecting" }, to: "reconnecting" },
    { from: "off", event: { type: "reconnecting" }, to: "off" },
    { from: "failed", event: { type: "reconnecting" }, to: "failed" },
    // disable / ended always rest to off
    { from: "live", event: { type: "disable" }, to: "off" },
    { from: "publishing", event: { type: "disable" }, to: "off" },
    { from: "reconnecting", event: { type: "ended" }, to: "off" },
    { from: "connecting", event: { type: "ended" }, to: "off" },
    // failures carry their reason
    { from: "publishing", event: { type: "failed", reason: "denied" }, to: "denied" },
    { from: "connecting", event: { type: "failed", reason: "unavailable" }, to: "unavailable" },
    { from: "pending", event: { type: "failed", reason: "failed" }, to: "failed" },
    // ILLEGAL: a resting failure/off can never be resurrected into live by a
    // stray publish confirmation — the stage LIVE-after-failure guard
    { from: "failed", event: { type: "published" }, to: "failed" },
    { from: "denied", event: { type: "published" }, to: "denied" },
    { from: "unavailable", event: { type: "published" }, to: "unavailable" },
    { from: "off", event: { type: "published" }, to: "off" },
    // ILLEGAL: a turned-off device is not dragged back by transport chatter
    { from: "off", event: { type: "connecting" }, to: "off" },
    { from: "off", event: { type: "publishing" }, to: "off" },
  ];

  it.each(cases)("$from --$event.type--> $to", ({ from, event, to }) => {
    expect(publicationReduce(from, event)).toBe(to);
  });

  it("a failed publish then a fresh enable can reach live again", () => {
    let s: MediaPublicationStatus = "off";
    s = publicationReduce(s, { type: "enable" });
    s = publicationReduce(s, { type: "connecting" });
    s = publicationReduce(s, { type: "failed", reason: "failed" });
    expect(s).toBe("failed");
    // A stray confirmation is ignored...
    expect(publicationReduce(s, { type: "published" })).toBe("failed");
    // ...but restarting the pipeline works.
    s = publicationReduce(s, { type: "enable" });
    s = publicationReduce(s, { type: "publishing" });
    s = publicationReduce(s, { type: "published" });
    expect(s).toBe("live");
  });
});

describe("status predicates", () => {
  it("isPublished is true only for live", () => {
    const all: MediaPublicationStatus[] = [
      "off",
      "pending",
      "connecting",
      "publishing",
      "live",
      "reconnecting",
      "denied",
      "unavailable",
      "failed",
    ];
    for (const s of all) expect(isPublished(s)).toBe(s === "live");
  });

  it("isPublishPending covers the in-flight states", () => {
    expect(isPublishPending("pending")).toBe(true);
    expect(isPublishPending("connecting")).toBe(true);
    expect(isPublishPending("publishing")).toBe(true);
    expect(isPublishPending("live")).toBe(false);
    expect(isPublishPending("failed")).toBe(false);
  });

  it("isPublishFailure covers the bounded failures", () => {
    expect(isPublishFailure("denied")).toBe(true);
    expect(isPublishFailure("unavailable")).toBe(true);
    expect(isPublishFailure("failed")).toBe(true);
    expect(isPublishFailure("live")).toBe(false);
    expect(isPublishFailure("off")).toBe(false);
  });
});

describe("classifyMediaError", () => {
  const domCases: { name: string; reason: string }[] = [
    { name: "NotAllowedError", reason: "denied" },
    { name: "SecurityError", reason: "denied" },
    { name: "PermissionDeniedError", reason: "denied" },
    { name: "NotFoundError", reason: "unavailable" },
    { name: "DevicesNotFoundError", reason: "unavailable" },
    { name: "OverconstrainedError", reason: "unavailable" },
    { name: "NotReadableError", reason: "failed" },
    { name: "AbortError", reason: "failed" },
  ];
  it.each(domCases)("$name -> $reason", ({ name, reason }) => {
    const err = new Error("x");
    err.name = name;
    expect(classifyMediaError(err)).toBe(reason);
  });

  it("classifies a plain object with a name field", () => {
    expect(classifyMediaError({ name: "NotAllowedError" })).toBe("denied");
  });

  it("falls back to failed for unknown/odd errors", () => {
    expect(classifyMediaError("boom")).toBe("failed");
    expect(classifyMediaError(null)).toBe("failed");
    expect(classifyMediaError(undefined)).toBe("failed");
    expect(classifyMediaError(42)).toBe("failed");
  });
});

describe("worstOutcome + outcomeNeedsAttention", () => {
  const outcome = (status: MediaOutcomeStatus): MediaOutcome => ({ status });

  it("empty is inactive", () => {
    expect(worstOutcome([])).toEqual({ status: "inactive" });
  });

  it("a failure outranks a success", () => {
    expect(worstOutcome([outcome("live"), outcome("denied")])).toEqual({ status: "denied" });
    expect(worstOutcome([outcome("failed"), outcome("live")])).toEqual({ status: "failed" });
  });

  it("orders denied > unavailable > failed", () => {
    expect(
      worstOutcome([outcome("failed"), outcome("unavailable"), outcome("denied")]).status,
    ).toBe("denied");
    expect(worstOutcome([outcome("failed"), outcome("unavailable")]).status).toBe("unavailable");
  });

  it("a concrete state beats inactive", () => {
    expect(worstOutcome([outcome("inactive"), outcome("off")]).status).toBe("off");
    expect(worstOutcome([outcome("inactive"), outcome("live")]).status).toBe("live");
  });

  it("needs attention only for failures", () => {
    expect(outcomeNeedsAttention("denied")).toBe(true);
    expect(outcomeNeedsAttention("unavailable")).toBe(true);
    expect(outcomeNeedsAttention("failed")).toBe(true);
    expect(outcomeNeedsAttention("live")).toBe(false);
    expect(outcomeNeedsAttention("off")).toBe(false);
    expect(outcomeNeedsAttention("inactive")).toBe(false);
  });
});
