/**
 * Pure decision logic for the in-app moderator dashboard (spec 26). No React /
 * DOM / net imports — plain values in, plain values out, exhaustively unit-tested.
 * The React panel (`ui/mod/ModPanel.tsx`) and the REST client (`net/moderation.ts`)
 * are thin glue over the helpers here:
 *   - the moderator-visibility probe state machine,
 *   - the suspension duration presets and their epoch-ms `until` mapping,
 *   - the report-row view model (labels + relative timestamp), and
 *   - the typed-error → human-text mapping shared by every action.
 */
import type { ModerationReport, ReportCategory } from "@metaverse/shared";

/* --------------------------- visibility probe ---------------------------- */

/**
 * Signin returns only `{ token }`, so moderator status is discovered by probing
 * `GET /api/v1/mod/reports` once per session: 200 ⇒ moderator, 404 ⇒ not. The
 * result is cached (a terminal state), so a transient error stays `unknown` and
 * is retried on the next Settings open rather than latching a wrong answer.
 */
export type ProbeState = "unknown" | "checking" | "moderator" | "not-moderator";

/** `check` fires the probe; `granted`/`denied` are its terminal outcomes; an
 *  errored probe emits `reset` to return to `unknown` (retryable). */
export type ProbeEvent = "check" | "granted" | "denied" | "reset";

/** Deterministic transition. Terminal states (moderator/not-moderator) are sticky. */
export function nextProbeState(state: ProbeState, event: ProbeEvent): ProbeState {
  if (state === "moderator" || state === "not-moderator") return state;
  switch (event) {
    case "check":
      return state === "unknown" ? "checking" : state;
    case "granted":
      return state === "checking" ? "moderator" : state;
    case "denied":
      return state === "checking" ? "not-moderator" : state;
    case "reset":
      return "unknown";
  }
}

/** True when a probe should be kicked off (only from the untried state). */
export function shouldProbe(state: ProbeState): boolean {
  return state === "unknown";
}

/** True once the probe resolved affirmatively — the Moderation button may show. */
export function isModerator(state: ProbeState): boolean {
  return state === "moderator";
}

/* --------------------------- suspend presets ----------------------------- */

export interface SuspendPreset {
  readonly id: string;
  readonly label: string;
  readonly ms: number;
}

const HOUR_MS = 3_600_000;

/** The only offered suspension durations (spec 26: 1h / 24h / 7d). */
export const SUSPEND_PRESETS: readonly SuspendPreset[] = [
  { id: "1h", label: "1 hour", ms: HOUR_MS },
  { id: "24h", label: "24 hours", ms: 24 * HOUR_MS },
  { id: "7d", label: "7 days", ms: 7 * 24 * HOUR_MS },
];

/** Map a preset duration to an absolute future epoch-ms `until`, from a given now. */
export function suspendUntil(nowMs: number, presetMs: number): number {
  return nowMs + presetMs;
}

/** Resolve a preset id to its record (undefined for an unknown id). */
export function presetById(id: string): SuspendPreset | undefined {
  return SUSPEND_PRESETS.find((p) => p.id === id);
}

/* --------------------------- report view model --------------------------- */

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment: "Harassment",
  hate: "Hate",
  spam: "Spam",
  sexual: "Sexual",
  "self-harm": "Self-harm",
  other: "Other",
};

/** Human label for a report category (falls back to the raw value if unknown). */
export function categoryLabel(category: ReportCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Relative, timezone-free timestamp label for a report's ISO `createdAt`, computed
 * against a supplied `nowMs` so it is deterministic and unit-testable. Falls back
 * to the raw string if the timestamp cannot be parsed.
 */
export function formatReportTimestamp(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaMs = Math.max(0, nowMs - then);
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface ReportRowView {
  readonly id: string;
  readonly reporterId: string;
  readonly targetId: string;
  readonly category: string;
  readonly note: string | null;
  readonly snapshot: string;
  readonly createdLabel: string;
}

/** Flatten one report into its rendered row fields. */
export function reportRowView(report: ModerationReport, nowMs: number): ReportRowView {
  return {
    id: report.id,
    reporterId: report.reporterId,
    targetId: report.targetId,
    category: categoryLabel(report.category),
    note: report.note,
    snapshot: report.messageText,
    createdLabel: formatReportTimestamp(report.createdAt, nowMs),
  };
}

/**
 * Build the render-ready row list. The server already returns newest-first; we
 * sort defensively by `createdAt` descending so the client never depends on that.
 */
export function reportRows(reports: readonly ModerationReport[], nowMs: number): ReportRowView[] {
  return [...reports]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((r) => reportRowView(r, nowMs));
}

/* ------------------------------ error text ------------------------------- */

/** Typed error codes surfaced by the moderation REST client. */
export type ModErrorCode =
  | "validation"
  | "invalid-until"
  | "target-not-found"
  | "not-found"
  | "rate-limited"
  | "unauthorized"
  | "network"
  | "unknown";

/** User-facing message for a failed moderation action. */
export function moderationErrorText(code: ModErrorCode): string {
  switch (code) {
    case "validation":
      return "That request was rejected — check the details and try again.";
    case "invalid-until":
      return "Pick a suspension end time in the future.";
    case "target-not-found":
      return "That user no longer exists.";
    case "not-found":
      return "That report is no longer available — refresh the list.";
    case "rate-limited":
      return "Too many moderation actions — wait a moment and try again.";
    case "unauthorized":
      return "Your session is no longer authorized for moderation.";
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    case "unknown":
    default:
      return "Something went wrong. Try again.";
  }
}
