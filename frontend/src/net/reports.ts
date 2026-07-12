/**
 * Chat-report REST client (PRD 25.12). Thin wrapper over `POST /api/v1/reports`,
 * whose wire shapes live in @metaverse/shared. Auth is the stored session JWT (the
 * same token the socket handshake uses). The client sends only the server-stamped
 * `messageId` + reason `category` (+ optional note) — the server binds the
 * author/target/text and rejects forged context.
 *
 * In mock mode there is no backend, so a report resolves to a local `created`
 * acknowledgement rather than throwing (the world stays fully playable offline).
 */
import type { ReportAckStatus, ReportCategory } from "@metaverse/shared";
import { authToken, serverBase, USE_MOCK } from "./auth";

export type ReportErrorCode =
  | "message-not-found"
  | "cannot-report-self"
  | "rate-limited"
  | "unauthorized"
  | "network"
  | "unknown";

export type ReportResult =
  | { ok: true; status: ReportAckStatus }
  | { ok: false; code: ReportErrorCode };

/** Map a coarse server error body / status to a typed client code. */
function errorCode(status: number, body: unknown): ReportErrorCode {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (error === "message-not-found") return "message-not-found";
  if (error === "cannot-report-self") return "cannot-report-self";
  if (status === 429) return "rate-limited";
  if (status === 401) return "unauthorized";
  return "unknown";
}

/** Submit a report for one broadcast chat line. Never throws — returns a result. */
export async function submitReport(
  messageId: string,
  category: ReportCategory,
  note?: string,
): Promise<ReportResult> {
  if (USE_MOCK) return { ok: true, status: "created" };
  let res: Response;
  try {
    res = await fetch(`${serverBase}/api/v1/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken()}`,
      },
      body: JSON.stringify(note ? { messageId, category, note } : { messageId, category }),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.ok) {
    try {
      const json = (await res.json()) as { status: ReportAckStatus };
      return { ok: true, status: json.status };
    } catch {
      return { ok: false, code: "unknown" };
    }
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // coarse fallback by status
  }
  return { ok: false, code: errorCode(res.status, body) };
}
