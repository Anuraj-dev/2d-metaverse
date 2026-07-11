import { describe, expect, it } from "vitest";
import { BlockCache, type BlockLoader } from "../src/blocks.js";

/**
 * Service-free unit tests for the block-pair cache (PRD 25.13). A fake loader
 * stands in for Postgres so the symmetric-suppression bookkeeping is exercised
 * without a database.
 */
function loaderFrom(edges: Array<[blocker: string, blocked: string]>): BlockLoader {
  return {
    listBlockedIds: async (userId) =>
      edges.filter(([blocker]) => blocker === userId).map(([, blocked]) => blocked),
    listBlockerIds: async (userId) =>
      edges.filter(([, blocked]) => blocked === userId).map(([blocker]) => blocker),
  };
}

describe("BlockCache", () => {
  it("is empty for an unloaded user", () => {
    const cache = new BlockCache(loaderFrom([["a", "b"]]));
    expect(cache.isBlockedPair("a", "b")).toBe(false);
    expect(cache.relatedIds("a")).toEqual([]);
  });

  it("suppresses in both directions — each endpoint answers from its own loaded set", async () => {
    // isBlockedPair(x, y) reads x's loaded relation; in the socket layer x is always
    // the connected (loaded) author, so both parties being connected is the real case.
    const cache = new BlockCache(loaderFrom([["a", "b"]]));
    await cache.ensureLoaded("a");
    expect(cache.isBlockedPair("a", "b")).toBe(true); // A blocked B (outgoing)
    // B not yet loaded → querying from B's perspective can't see the edge.
    expect(cache.isBlockedPair("b", "a")).toBe(false);
    // Once B is loaded it sees the incoming edge, so B→A delivery is suppressed too.
    await cache.ensureLoaded("b");
    expect(cache.isBlockedPair("b", "a")).toBe(true);
    expect(cache.relatedIds("b")).toEqual(["a"]);
  });

  it("relatedIds unions outgoing and incoming edges without duplicates", async () => {
    const cache = new BlockCache(loaderFrom([["a", "b"], ["c", "a"], ["a", "d"]]));
    await cache.ensureLoaded("a");
    expect(new Set(cache.relatedIds("a"))).toEqual(new Set(["b", "c", "d"]));
  });

  it("blockedBy returns only the user's outgoing blocks", async () => {
    const cache = new BlockCache(loaderFrom([["a", "b"], ["c", "a"]]));
    await cache.ensureLoaded("a");
    expect(new Set(cache.blockedBy("a"))).toEqual(new Set(["b"]));
  });

  it("does not report self-blocks and leaves unrelated pairs untouched", async () => {
    const cache = new BlockCache(loaderFrom([["a", "b"]]));
    await cache.ensureLoaded("a");
    expect(cache.isBlockedPair("a", "a")).toBe(false);
    expect(cache.isBlockedPair("a", "z")).toBe(false);
  });

  it("addBlock reflects a live block into both loaded endpoints", async () => {
    const cache = new BlockCache(loaderFrom([]));
    await cache.ensureLoaded("a");
    await cache.ensureLoaded("b");
    cache.addBlock("a", "b");
    expect(cache.isBlockedPair("a", "b")).toBe(true);
    expect(cache.isBlockedPair("b", "a")).toBe(true);
    expect(cache.relatedIds("b")).toEqual(["a"]);
  });

  it("addBlock is a no-op for an endpoint that is not loaded", async () => {
    const cache = new BlockCache(loaderFrom([]));
    await cache.ensureLoaded("a");
    // b never loaded — its incoming set is absent, so nothing to update there.
    cache.addBlock("a", "b");
    expect(cache.isBlockedPair("a", "b")).toBe(true);
    expect(cache.blockedBy("a")).toEqual(["b"]);
  });

  it("removeBlock clears both directions (future-only unblock)", async () => {
    const cache = new BlockCache(loaderFrom([["a", "b"]]));
    await cache.ensureLoaded("a");
    await cache.ensureLoaded("b");
    cache.removeBlock("a", "b");
    expect(cache.isBlockedPair("a", "b")).toBe(false);
    expect(cache.isBlockedPair("b", "a")).toBe(false);
    expect(cache.blockedBy("a")).toEqual([]);
  });

  it("ensureLoaded loads once and coalesces concurrent calls", async () => {
    let calls = 0;
    const loader: BlockLoader = {
      listBlockedIds: async (u) => {
        calls += 1;
        return u === "a" ? ["b"] : [];
      },
      listBlockerIds: async () => [],
    };
    const cache = new BlockCache(loader);
    await Promise.all([cache.ensureLoaded("a"), cache.ensureLoaded("a")]);
    await cache.ensureLoaded("a");
    // One physical load for user "a" despite three ensureLoaded calls.
    expect(calls).toBe(1);
    expect(cache.blockedBy("a")).toEqual(["b"]);
  });
});
