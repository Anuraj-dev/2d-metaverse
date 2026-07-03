/**
 * Arcade high-score REST client. Thin wrapper over the backend resource whose
 * wire shapes live in @metaverse/shared. Auth is the stored session JWT (the
 * same token the socket handshake uses).
 *
 * In mock mode there is no backend, so calls resolve to an empty leaderboard
 * rather than throwing — the games are fully playable offline, scores just do
 * not persist.
 */
import type { ArcadeGame, ArcadeLeaderboard } from "@metaverse/shared";
import { authToken, serverBase, USE_MOCK } from "./auth";

function emptyBoard(game: ArcadeGame): ArcadeLeaderboard {
  return { game, top: [], best: null };
}

async function request(path: string, init: RequestInit): Promise<ArcadeLeaderboard | null> {
  if (USE_MOCK) return null;
  const res = await fetch(`${serverBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken()}`,
    },
  });
  if (!res.ok) throw new Error(`arcade request failed (${res.status})`);
  return (await res.json()) as ArcadeLeaderboard;
}

/** Fetch the top-N leaderboard for a cabinet plus the caller's personal best. */
export async function fetchLeaderboard(game: ArcadeGame): Promise<ArcadeLeaderboard> {
  const board = await request(`/api/v1/arcade/scores/${game}`, { method: "GET" });
  return board ?? emptyBoard(game);
}

/** Submit a run's score; returns the refreshed leaderboard + updated best. */
export async function submitScore(
  game: ArcadeGame,
  score: number
): Promise<ArcadeLeaderboard> {
  const board = await request(`/api/v1/arcade/scores`, {
    method: "POST",
    body: JSON.stringify({ game, score }),
  });
  return board ?? emptyBoard(game);
}
