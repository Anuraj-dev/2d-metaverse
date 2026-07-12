import { describe, expect, it } from "vitest";
import { REPORT_CATEGORIES } from "@metaverse/shared";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_CATEGORY_OPTIONS,
  reportResultNotice,
} from "./report";
import type { ReportErrorCode } from "../net/reports";

describe("report category options", () => {
  it("covers every shared category, in canonical order, with a non-empty label", () => {
    expect(REPORT_CATEGORY_OPTIONS.map((o) => o.value)).toEqual([...REPORT_CATEGORIES]);
    for (const category of REPORT_CATEGORIES) {
      expect(REPORT_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
  });
});

describe("reportResultNotice", () => {
  it("acknowledges a fresh report distinctly from a duplicate", () => {
    const created = reportResultNotice({ ok: true, status: "created" });
    const duplicate = reportResultNotice({ ok: true, status: "duplicate" });
    expect(created).toMatch(/sent to the moderators/i);
    expect(duplicate).toMatch(/already reported/i);
    expect(created).not.toBe(duplicate);
  });

  it.each<[ReportErrorCode, RegExp]>([
    ["cannot-report-self", /your own message/i],
    ["message-not-found", /too old/i],
    ["rate-limited", /too fast/i],
    ["unauthorized", /sign in/i],
    ["network", /connection/i],
    ["unknown", /try again/i],
  ])("explains the %s failure", (code, pattern) => {
    expect(reportResultNotice({ ok: false, code })).toMatch(pattern);
  });
});
