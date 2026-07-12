/**
 * Pure report presentation logic (PRD 25.12): maps a report outcome to the chat
 * system-line the user sees, and names each reason category for the picker. No
 * Phaser / net / DOM imports — plain values in, plain strings out.
 */
import { REPORT_CATEGORIES, type ReportCategory } from "@metaverse/shared";
import type { ReportErrorCode, ReportResult } from "../net/reports";

/** Human labels for the reason picker, in the shared canonical order. */
export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment: "Harassment or bullying",
  hate: "Hate or discrimination",
  spam: "Spam or flooding",
  sexual: "Sexual or explicit",
  "self-harm": "Self-harm or crisis",
  other: "Something else",
};

/** The picker options, derived from the shared category list (single source). */
export const REPORT_CATEGORY_OPTIONS: ReadonlyArray<{ value: ReportCategory; label: string }> =
  REPORT_CATEGORIES.map((value) => ({ value, label: REPORT_CATEGORY_LABELS[value] }));

/** The reason the picker opens on. Named (not index-0) to stay strict-TS safe. */
export const DEFAULT_REPORT_CATEGORY: ReportCategory = "harassment";

function errorNotice(code: ReportErrorCode): string {
  switch (code) {
    case "cannot-report-self":
      return "You can't report your own message.";
    case "message-not-found":
      return "That message is too old to report.";
    case "rate-limited":
      return "You're reporting too fast — wait a moment and try again.";
    case "unauthorized":
      return "Please sign in again to report.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    case "unknown":
    default:
      return "Couldn't send your report. Please try again.";
  }
}

/** The chat system-line acknowledging (or explaining the failure of) a report. */
export function reportResultNotice(result: ReportResult): string {
  if (!result.ok) return errorNotice(result.code);
  return result.status === "duplicate"
    ? "You've already reported that message — moderators have it."
    : "Thanks — your report was sent to the moderators.";
}
