/**
 * Persistent-block REST client (PRD 25.13). Thin wrapper over `/api/v1/blocks`,
 * whose wire shapes live in @metaverse/shared. Auth is the stored session JWT
 * (the same token the socket handshake uses). The client names only the target's
 * player id; the blocker is bound server-side.
 *
 * Local mute has NO server surface — it lives entirely in `media/localModeration`.
 *
 * In mock mode there is no backend, so calls resolve to a local success and the
 * initial block list is empty (the world stays fully playable offline).
 */
import type { BlockAckStatus } from "@metaverse/shared";
import { authToken, serverBase, USE_MOCK } from "./auth";

export type BlockErrorCode = "cannot-block-self" | "rate-limited" | "unauthorized" | "network" | "unknown";

export type BlockResult =
  | { ok: true; status: BlockAckStatus }
  | { ok: false; code: BlockErrorCode };

function errorCode(status: number, body: unknown): BlockErrorCode {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (error === "cannot-block-self") return "cannot-block-self";
  if (status === 429) return "rate-limited";
  if (status === 401) return "unauthorized";
  return "unknown";
}

async function mutate(method: "POST" | "DELETE", targetId: string): Promise<BlockResult> {
  if (USE_MOCK) return { ok: true, status: method === "POST" ? "blocked" : "unblocked" };
  let res: Response;
  try {
    res = await fetch(`${serverBase}/api/v1/blocks`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken()}`,
      },
      body: JSON.stringify({ targetId }),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.ok) {
    try {
      const json = (await res.json()) as { status: BlockAckStatus };
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

/** Persistently block a player. Never throws — returns a typed result. */
export function blockUser(targetId: string): Promise<BlockResult> {
  return mutate("POST", targetId);
}

/** Remove a persistent block (restores only future communication). */
export function unblockUser(targetId: string): Promise<BlockResult> {
  return mutate("DELETE", targetId);
}

/** Load the player's own block list on connect. Empty in mock mode / on failure. */
export async function fetchBlockedIds(): Promise<string[]> {
  if (USE_MOCK) return [];
  try {
    const res = await fetch(`${serverBase}/api/v1/blocks`, {
      headers: { Authorization: `Bearer ${authToken()}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { blocked?: unknown };
    return Array.isArray(json.blocked) ? json.blocked.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
