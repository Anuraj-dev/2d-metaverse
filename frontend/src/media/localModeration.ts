/**
 * Session-scoped moderation store (PRD 25.13) — the single client-side surface
 * for "who this viewer is muting/blocking", read by the media layer (audio/video/
 * speaking suppression) and the chat UI.
 *
 * Transport-adjacent but plain data (mirrors `speakingState`): id sets in,
 * subscription out; every actual decision defers to the pure `game/muteBlock`
 * module. Holds two sets:
 *  - `muted`: local mute — browser-SESSION-only and reversible. Deliberately NOT
 *    persisted to localStorage: it evaporates on refresh, by design.
 *  - `blocked`: a mirror of the server-owned persistent block list, loaded on
 *    connect and updated as the player blocks/unblocks. The server does the
 *    authoritative, symmetric chat/whisper filtering; this copy only drives local
 *    LiveKit audio/video + speaking suppression (the server can't unpublish a
 *    track selectively).
 */
import { audioMutedIds, filterSpeaking, isCommsSuppressed, isVideoHidden } from "../game/muteBlock";

class LocalModeration {
  private muted = new Set<string>();
  private blocked = new Set<string>();
  private readonly listeners = new Set<() => void>();

  /* --------------------------------- reads -------------------------------- */
  /** Ids whose incoming audio must be forced silent (mute ∪ block). */
  audioMutedIds(): Set<string> {
    return audioMutedIds(this.muted, this.blocked);
  }
  /** Whether a player's chat/speaking should be hidden for this viewer. */
  isCommsSuppressed(id: string): boolean {
    return isCommsSuppressed(id, this.muted, this.blocked);
  }
  /** Whether a player's video should be hidden (blocked only). */
  isVideoHidden(id: string): boolean {
    return isVideoHidden(id, this.blocked);
  }
  /** Drop suppressed ids from an active-speaker set. */
  filterSpeaking(ids: Iterable<string>): string[] {
    return filterSpeaking(ids, this.muted, this.blocked);
  }
  isMuted(id: string): boolean {
    return this.muted.has(id);
  }
  isBlocked(id: string): boolean {
    return this.blocked.has(id);
  }
  /** All currently muted ids (for the management list). */
  mutedIds(): string[] {
    return [...this.muted];
  }
  /** All currently blocked ids, incl. offline ones (for the management list). */
  blockedIds(): string[] {
    return [...this.blocked];
  }

  /* -------------------------------- writes -------------------------------- */
  /** Toggle a session-local mute; returns the new muted state for that id. */
  toggleMute(id: string): boolean {
    const nowMuted = !this.muted.has(id);
    if (nowMuted) this.muted.add(id);
    else this.muted.delete(id);
    this.notify();
    return nowMuted;
  }
  /** Replace the block list (from the server), e.g. on connect. */
  setBlocked(ids: Iterable<string>): void {
    this.blocked = new Set(ids);
    this.notify();
  }
  /** Reflect a just-succeeded block locally (media/speaking suppression). */
  addBlocked(id: string): void {
    if (this.blocked.has(id)) return;
    this.blocked.add(id);
    this.notify();
  }
  /** Reflect a just-succeeded unblock locally. Mute is left untouched. */
  removeBlocked(id: string): void {
    if (!this.blocked.delete(id)) return;
    this.notify();
  }

  /* ----------------------------- subscription ----------------------------- */
  /** Subscribe to any change; fires immediately. Returns an unsubscribe. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    cb();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

/** Process-wide session moderation surface (mirrors the module-singleton rooms). */
export const localModeration = new LocalModeration();
