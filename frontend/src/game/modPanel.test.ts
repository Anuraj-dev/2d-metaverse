import { describe, expect, it } from "vitest";
import type { ModerationReport } from "@metaverse/shared";
import {
  categoryLabel,
  formatReportTimestamp,
  isModerator,
  moderationErrorText,
  nextProbeState,
  presetById,
  reportRows,
  reportRowView,
  shouldProbe,
  SUSPEND_PRESETS,
  suspendUntil,
  type ModErrorCode,
  type ProbeEvent,
  type ProbeState,
} from "./modPanel";

const report = (over: Partial<ModerationReport> = {}): ModerationReport => ({
  id: "r1",
  reporterId: "rep-1",
  targetId: "tgt-1",
  messageId: "m1",
  messageText: "bad words",
  scope: "space:1",
  category: "harassment",
  note: null,
  status: "open",
  createdAt: "2026-07-12T12:00:00.000Z",
  ...over,
});

describe("probe state machine", () => {
  const cases: Array<[ProbeState, ProbeEvent, ProbeState]> = [
    ["unknown", "check", "checking"],
    ["checking", "granted", "moderator"],
    ["checking", "denied", "not-moderator"],
    ["checking", "reset", "unknown"],
    // terminal states are sticky
    ["moderator", "check", "moderator"],
    ["moderator", "denied", "moderator"],
    ["not-moderator", "check", "not-moderator"],
    ["not-moderator", "granted", "not-moderator"],
    // illegal / out-of-order transitions are no-ops
    ["unknown", "granted", "unknown"],
    ["unknown", "denied", "unknown"],
    ["checking", "check", "checking"],
  ];
  it.each(cases)("%s + %s -> %s", (state, event, expected) => {
    expect(nextProbeState(state, event)).toBe(expected);
  });

  it("shouldProbe only from unknown", () => {
    expect(shouldProbe("unknown")).toBe(true);
    for (const s of ["checking", "moderator", "not-moderator"] as const) {
      expect(shouldProbe(s)).toBe(false);
    }
  });

  it("isModerator only when resolved affirmatively", () => {
    expect(isModerator("moderator")).toBe(true);
    for (const s of ["unknown", "checking", "not-moderator"] as const) {
      expect(isModerator(s)).toBe(false);
    }
  });
});

describe("suspend presets", () => {
  it("offers 1h / 24h / 7d in order", () => {
    expect(SUSPEND_PRESETS.map((p) => p.id)).toEqual(["1h", "24h", "7d"]);
  });

  it.each([
    ["1h", 3_600_000],
    ["24h", 86_400_000],
    ["7d", 604_800_000],
  ])("%s maps to the right offset", (id, ms) => {
    expect(presetById(id)?.ms).toBe(ms);
  });

  it("suspendUntil adds the offset to now (always future)", () => {
    const now = 1_000_000;
    expect(suspendUntil(now, 3_600_000)).toBe(4_600_000);
    expect(suspendUntil(now, 3_600_000)).toBeGreaterThan(now);
  });

  it("presetById returns undefined for an unknown id", () => {
    expect(presetById("nope")).toBeUndefined();
  });
});

describe("report view model", () => {
  it("categoryLabel humanizes every category", () => {
    expect(categoryLabel("harassment")).toBe("Harassment");
    expect(categoryLabel("self-harm")).toBe("Self-harm");
    expect(categoryLabel("other")).toBe("Other");
  });

  it.each([
    [0, "just now"],
    [30_000, "just now"],
    [60_000, "1m ago"],
    [59 * 60_000, "59m ago"],
    [60 * 60_000, "1h ago"],
    [23 * 3_600_000, "23h ago"],
    [24 * 3_600_000, "1d ago"],
    [3 * 24 * 3_600_000, "3d ago"],
  ])("formatReportTimestamp %d ms ago -> %s", (delta, expected) => {
    const created = "2026-07-12T12:00:00.000Z";
    const now = Date.parse(created) + delta;
    expect(formatReportTimestamp(created, now)).toBe(expected);
  });

  it("formatReportTimestamp falls back to raw on an unparseable value", () => {
    expect(formatReportTimestamp("not-a-date", 0)).toBe("not-a-date");
  });

  it("reportRowView flattens the fields", () => {
    const now = Date.parse("2026-07-12T12:05:00.000Z");
    const view = reportRowView(report({ note: "context" }), now);
    expect(view).toMatchObject({
      id: "r1",
      reporterId: "rep-1",
      targetId: "tgt-1",
      category: "Harassment",
      note: "context",
      snapshot: "bad words",
      createdLabel: "5m ago",
    });
  });

  it("reportRows sorts newest-first regardless of input order", () => {
    const older = report({ id: "old", createdAt: "2026-07-12T10:00:00.000Z" });
    const newer = report({ id: "new", createdAt: "2026-07-12T11:00:00.000Z" });
    const rows = reportRows([older, newer], Date.parse("2026-07-12T12:00:00.000Z"));
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("error text", () => {
  const codes: ModErrorCode[] = [
    "validation",
    "invalid-until",
    "target-not-found",
    "not-found",
    "rate-limited",
    "unauthorized",
    "network",
    "unknown",
  ];
  it.each(codes)("%s maps to a non-empty message", (code) => {
    expect(moderationErrorText(code).length).toBeGreaterThan(0);
  });
});
