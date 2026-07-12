/**
 * In-memory block-pair cache (PRD 25.13) — the delivery-filter seam.
 *
 * Server-owned blocks are the authoritative source (Postgres via `repository`),
 * but consulting the DB on every chat line would be a needless round-trip. This
 * cache mirrors, for each *connected* user, both directions of their block
 * relation — the ids they blocked ("out") and the ids that blocked them ("in") —
 * loaded once on join. Because any two users exchanging chat are both connected,
 * `isBlockedPair` can answer purely from cache, and `relatedIds` yields every id
 * a given author must be filtered against (in either direction).
 *
 * The block itself is directed, but suppression is symmetric: A blocking B hides
 * B's messages from A *and* A's messages from B. Keeping both edges per user lets
 * a single lookup enforce that without scanning every other user's set.
 *
 * Pure map bookkeeping with an injected loader — unit-tested service-free
 * (`test/blocks.test.ts`). The process singleton wiring the real Postgres loader
 * lives in `block-cache.ts` so this module never imports the DB layer.
 */
export interface BlockLoader {
  /** Ids this user has blocked (outgoing). */
  listBlockedIds(userId: string): Promise<string[]>;
  /** Ids that have blocked this user (incoming). */
  listBlockerIds(userId: string): Promise<string[]>;
}

export class BlockCache {
  private readonly out = new Map<string, Set<string>>();
  private readonly inc = new Map<string, Set<string>>();
  private readonly loading = new Map<string, Promise<void>>();

  constructor(private readonly loader: BlockLoader) {}

  /**
   * Load both directions of a user's block relation into the cache (once). Safe to
   * call on every join/recover — a already-loaded or in-flight user is a no-op, and
   * concurrent callers share the same load promise.
   */
  async ensureLoaded(userId: string): Promise<void> {
    if (this.out.has(userId)) return;
    const existing = this.loading.get(userId);
    if (existing) return existing;
    const load = (async () => {
      const [blocked, blockers] = await Promise.all([
        this.loader.listBlockedIds(userId),
        this.loader.listBlockerIds(userId),
      ]);
      this.out.set(userId, new Set(blocked));
      this.inc.set(userId, new Set(blockers));
    })().finally(() => this.loading.delete(userId));
    this.loading.set(userId, load);
    return load;
  }

  /** True when A and B are in a block relation in *either* direction. */
  isBlockedPair(a: string, b: string): boolean {
    return Boolean(this.out.get(a)?.has(b)) || Boolean(this.inc.get(a)?.has(b));
  }

  /**
   * Every id `author` must be filtered against (blocked-by-author ∪ blockers-of-
   * author). Callers map these to connected sockets to exclude from a broadcast.
   */
  relatedIds(author: string): string[] {
    const ids = new Set<string>(this.out.get(author) ?? []);
    for (const id of this.inc.get(author) ?? []) ids.add(id);
    return [...ids];
  }

  /** The ids a (loaded) user has blocked — the block list surfaced to that user. */
  blockedBy(userId: string): string[] {
    return [...(this.out.get(userId) ?? [])];
  }

  /** Reflect a fresh block into the cache for any currently-loaded endpoint. */
  addBlock(blockerId: string, blockedId: string): void {
    this.out.get(blockerId)?.add(blockedId);
    this.inc.get(blockedId)?.add(blockerId);
  }

  /** Reflect an unblock into the cache for any currently-loaded endpoint. */
  removeBlock(blockerId: string, blockedId: string): void {
    this.out.get(blockerId)?.delete(blockedId);
    this.inc.get(blockedId)?.delete(blockerId);
  }
}
