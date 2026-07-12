/**
 * Local mute + persistent block — the pure client-side filtering decisions
 * (PRD 25.13). No Phaser / net / DOM imports (scene-as-glue convention): plain
 * id sets in, plain answers out, unit-tested in isolation.
 *
 * Two distinct concepts:
 *  - **Local mute** is browser-session-only and reversible (never persisted). It
 *    silences a player's incoming audio, their speaking feedback, and hides their
 *    chat lines — for THIS viewer only, with no server involvement.
 *  - **Block** is server-owned and persistent. The server already filters chat/
 *    whisper delivery in both directions, so the client copy of the block list is
 *    used only to mute blocked players' LiveKit audio/video + speaking feedback
 *    locally (the server cannot selectively unpublish a LiveKit track). A blocked
 *    player stays visible in the world/roster — only their communication is
 *    suppressed.
 *
 * Muting scopes, by concept:
 *  - audio + speaking + chat: muted OR blocked (`isCommsSuppressed`)
 *  - video: blocked only (`isVideoHidden`) — a local mute leaves video intact
 */

/** Ids whose incoming world/room audio should be forced silent (mute ∪ block). */
export function audioMutedIds(
  muted: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>(muted);
  for (const id of blocked) out.add(id);
  return out;
}

/**
 * Whether a player's *communication* (chat lines and speaking feedback) should be
 * suppressed for this viewer — true if they are locally muted or blocked.
 */
export function isCommsSuppressed(
  id: string,
  muted: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): boolean {
  return muted.has(id) || blocked.has(id);
}

/** Whether a player's video should be hidden — blocked only (mute keeps video). */
export function isVideoHidden(id: string, blocked: ReadonlySet<string>): boolean {
  return blocked.has(id);
}

/** Drop suppressed ids from an active-speaker set (mute ∪ block). */
export function filterSpeaking(
  ids: Iterable<string>,
  muted: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!isCommsSuppressed(id, muted, blocked)) out.push(id);
  }
  return out;
}
