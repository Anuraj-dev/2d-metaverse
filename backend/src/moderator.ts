/**
 * Moderator authority (PRD 25.14). Authority comes from ONE place: the validated
 * operator allowlist in config (`config.moderatorIds`, parsed from
 * MODERATOR_USER_IDS). Room admins get no global power — this module never
 * consults the room-admin system. `requireModerator` is the REST gate.
 */
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { verifyToken, type AuthenticatedRequest } from "./auth.js";

/** Pure allowlist membership check (ids are compared case-insensitively). */
export function isModerator(moderatorIds: readonly string[], userId: string): boolean {
  const needle = userId.toLowerCase();
  return moderatorIds.some((id) => id.toLowerCase() === needle);
}

/**
 * Gate a route to allowlisted moderators only. Verifies the bearer token AND
 * allowlist membership; ANY failure (missing/invalid token, or an authenticated
 * user not on the allowlist) answers a uniform 404 `{ error: "not-found" }` — the
 * same shape as the app's catch-all — so the moderator surface never confirms its
 * own existence to a non-moderator (we always choose 404 over 403 for auth
 * failures here). On success it attaches `request.user` like `requireAuth`.
 */
export function requireModerator(request: Request, response: Response, next: NextFunction): void {
  const header = request.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const user = verifyToken(token);
  if (!user || !isModerator(config.moderatorIds, user.id)) {
    response.status(404).json({ error: "not-found" });
    return;
  }
  (request as AuthenticatedRequest).user = user;
  next();
}
