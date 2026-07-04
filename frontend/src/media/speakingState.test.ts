import { describe, it, expect } from "vitest";
import { SpeakingState } from "./speakingState";

/** Sorted array view of the read-only set, for stable equality assertions. */
function ids(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

describe("SpeakingState (who-is-speaking seam)", () => {
  it("starts empty", () => {
    expect(ids(new SpeakingState().speaking)).toEqual([]);
  });

  it("unions identities across independent sources", () => {
    const s = new SpeakingState();
    s.setSpeakers("world", ["a", "b"]);
    s.setSpeakers("stage", ["c"]);
    expect(ids(s.speaking)).toEqual(["a", "b", "c"]);
  });

  it("keeps sources isolated: replacing one leaves the other intact", () => {
    const s = new SpeakingState();
    s.setSpeakers("world", ["a", "b"]);
    s.setSpeakers("stage", ["c"]);
    // Replace only the world set — stage's contribution survives.
    s.setSpeakers("world", ["a"]);
    expect(ids(s.speaking)).toEqual(["a", "c"]);
  });

  it("dedupes an identity present in more than one source", () => {
    const s = new SpeakingState();
    s.setSpeakers("world", ["a", "b"]);
    s.setSpeakers("stage", ["b", "c"]);
    expect(ids(s.speaking)).toEqual(["a", "b", "c"]);
    // Dropping 'b' from world alone keeps it — stage still reports it.
    s.setSpeakers("world", ["a"]);
    expect(ids(s.speaking)).toEqual(["a", "b", "c"]);
    // 'b' only leaves the union once BOTH sources stop reporting it.
    s.setSpeakers("stage", ["c"]);
    expect(ids(s.speaking)).toEqual(["a", "c"]);
  });

  it("union shrinks when a source is cleared", () => {
    const s = new SpeakingState();
    s.setSpeakers("world", ["a", "b"]);
    s.setSpeakers("stage", ["c"]);
    s.clear("stage");
    expect(ids(s.speaking)).toEqual(["a", "b"]);
    s.clear("world");
    expect(ids(s.speaking)).toEqual([]);
  });

  it("subscribe fires immediately with the current set", () => {
    const s = new SpeakingState();
    s.setSpeakers("world", ["a"]);
    let seen: string[] | null = null;
    s.subscribe((set) => {
      seen = ids(set);
    });
    expect(seen).toEqual(["a"]);
  });

  it("notifies subscribers on a real change and unsubscribe stops delivery", () => {
    const s = new SpeakingState();
    const seen: string[][] = [];
    const off = s.subscribe((set) => seen.push(ids(set)));
    s.setSpeakers("world", ["a"]);
    s.setSpeakers("world", ["a", "b"]);
    off();
    s.setSpeakers("world", ["a", "b", "c"]); // after unsubscribe → not seen
    expect(seen).toEqual([[], ["a"], ["a", "b"]]);
  });

  it("does NOT re-notify on a redundant update (same identities, order-independent)", () => {
    const s = new SpeakingState();
    let calls = 0;
    s.subscribe(() => calls++); // 1: immediate
    s.setSpeakers("world", ["a", "b"]); // 2: real change
    s.setSpeakers("world", ["b", "a"]); // same set, different order → no notify
    s.setSpeakers("world", ["a", "b"]); // identical again → no notify
    expect(calls).toBe(2);
  });

  it("does NOT re-notify when clearing an unknown source", () => {
    const s = new SpeakingState();
    let calls = 0;
    s.subscribe(() => calls++); // 1: immediate
    s.clear("stage"); // never set → no change → no notify
    expect(calls).toBe(1);
  });
});
