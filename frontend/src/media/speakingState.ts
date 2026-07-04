/**
 * Reusable "who is speaking" surface — the thin transport seam between LiveKit's
 * active-speaker detection and any consumer that needs speech state.
 *
 * LiveKit rooms push their active-speaker identity set in via `setSpeakers(source,
 * ids)` (the world room now; the stage broadcast room in PRD 17); any number of
 * consumers subscribe to the union across sources. Transport-adjacent but plain
 * data: string identities (== playerId) in, a `ReadonlySet` out — it makes ZERO
 * mixing, proximity or duck decisions (those are the pure `soundMixer`'s job). The
 * LiveKit event wiring that feeds it (`livekit.ts`) stays untested beyond types per
 * convention; the store's own union/dedupe/clear logic is unit-tested
 * (`speakingState.test.ts`).
 */
export type SpeakingSource = "world" | "stage";

export class SpeakingState {
  private readonly bySource = new Map<SpeakingSource, ReadonlySet<string>>();
  private readonly listeners = new Set<(speaking: ReadonlySet<string>) => void>();
  private union: ReadonlySet<string> = new Set<string>();

  /** Replace the speaking-identity set contributed by one source. */
  setSpeakers(source: SpeakingSource, ids: Iterable<string>): void {
    this.bySource.set(source, new Set(ids));
    this.recompute();
  }

  /** Drop a source entirely (its room left / disconnected). */
  clear(source: SpeakingSource): void {
    if (this.bySource.delete(source)) this.recompute();
  }

  /** Current union of all speaking identities across sources. */
  get speaking(): ReadonlySet<string> {
    return this.union;
  }

  /**
   * Subscribe to the speaking set changing; fires immediately with the current
   * set. Returns an unsubscribe. Multiple consumers may subscribe independently.
   */
  subscribe(cb: (speaking: ReadonlySet<string>) => void): () => void {
    this.listeners.add(cb);
    cb(this.union);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private recompute(): void {
    const next = new Set<string>();
    for (const set of this.bySource.values()) {
      for (const id of set) next.add(id);
    }
    // Active-speaker events are chatty; skip the notify when the union is
    // unchanged so consumers only re-decide on a real change.
    if (next.size === this.union.size && [...next].every((id) => this.union.has(id))) {
      return;
    }
    this.union = next;
    this.listeners.forEach((cb) => cb(this.union));
  }
}

/** Process-wide speaking-state surface (mirrors the module-singleton livekit rooms). */
export const speakingState = new SpeakingState();
