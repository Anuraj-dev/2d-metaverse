/**
 * Moderator dashboard REST client (spec 26). Thin wrapper over the `/api/v1/mod`
 * surface, whose wire shapes live in @metaverse/shared. Auth is the stored session
 * JWT (the same token the socket handshake uses). No existing routes/payloads
 * change — this only reads the moderator endpoints and fires the mutating actions.
 *
 * Visibility is discovered by probing `GET /reports`: a moderator gets 200, a
 * non-moderator gets a uniform 404 (the server never confirms the route to a
 * non-moderator). Every function is total — it returns a typed result, never throws.
 *
 * In mock mode there is no backend, so the probe denies and no moderator UI ever
 * mounts (the world stays fully playable offline).
 */
import type {
  ModerationReport,
  ModerationReportList,
} from "@metaverse/shared";
import { authToken, serverBase, USE_MOCK } from "./auth";
import type { ModErrorCode } from "../game/modPanel";

/** Probe outcome: affirmative, negative (404), or an inconclusive transport/error. */
export type ProbeResult = "granted" | "denied" | "error";

export type ReportsResult =
  | { ok: true; reports: ModerationReport[] }
  | { ok: false; code: ModErrorCode };

export type ModActionResult = { ok: true } | { ok: false; code: ModErrorCode };

function authHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${authToken()}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

/** Map a coarse server error body / status to a typed client code. */
function errorCode(status: number, body: unknown): ModErrorCode {
  const error =
    typeof body === "object" && body !== null && "error" in body ? (body as { error: unknown }).error : undefined;
  if (error === "validation") return "validation";
  if (error === "invalid-until") return "invalid-until";
  if (error === "target-not-found") return "target-not-found";
  if (error === "not-found") return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 404) return status === 401 ? "unauthorized" : "not-found";
  return "unknown";
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Probe moderator visibility once per session. 200 ⇒ granted, 404 ⇒ denied,
 * anything else (incl. a network failure) ⇒ error, so a transient blip is retried
 * rather than latching a wrong answer.
 */
export async function probeModerator(): Promise<ProbeResult> {
  if (USE_MOCK) return "denied";
  let res: Response;
  try {
    res = await fetch(`${serverBase}/api/v1/mod/reports`, { headers: authHeaders(false) });
  } catch {
    return "error";
  }
  if (res.ok) return "granted";
  if (res.status === 404) return "denied";
  return "error";
}

/** Fetch the open report queue (newest first). */
export async function fetchReports(): Promise<ReportsResult> {
  if (USE_MOCK) return { ok: true, reports: [] };
  let res: Response;
  try {
    res = await fetch(`${serverBase}/api/v1/mod/reports`, { headers: authHeaders(false) });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.ok) {
    const json = (await readBody(res)) as ModerationReportList | null;
    const reports = json && Array.isArray(json.reports) ? json.reports : [];
    return { ok: true, reports };
  }
  return { ok: false, code: errorCode(res.status, await readBody(res)) };
}

async function post(path: string, body?: unknown): Promise<ModActionResult> {
  if (USE_MOCK) return { ok: true };
  let res: Response;
  try {
    res = await fetch(`${serverBase}${path}`, {
      method: "POST",
      headers: authHeaders(body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.ok) return { ok: true };
  return { ok: false, code: errorCode(res.status, await readBody(res)) };
}

/** Dismiss a report with no action against the target. */
export function dismissReport(reportId: string): Promise<ModActionResult> {
  return post(`/api/v1/mod/reports/${encodeURIComponent(reportId)}/dismiss`);
}

/** Record a warning against a user. */
export function warnUser(targetId: string, reason?: string): Promise<ModActionResult> {
  return post("/api/v1/mod/warn", reason ? { targetId, reason } : { targetId });
}

/** Suspend a user until an epoch-ms timestamp (must be in the future). */
export function suspendUser(targetId: string, until: number, reason?: string): Promise<ModActionResult> {
  return post("/api/v1/mod/suspend", reason ? { targetId, until, reason } : { targetId, until });
}

/** Reverse a suspension, restoring the user's access. */
export function unsuspendUser(targetId: string): Promise<ModActionResult> {
  return post("/api/v1/mod/unsuspend", { targetId });
}
