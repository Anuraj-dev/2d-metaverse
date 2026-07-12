import { describe, expect, it } from "vitest";
import { audioMutedIds, filterSpeaking, isCommsSuppressed, isVideoHidden } from "./muteBlock";

const set = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe("muteBlock pure decisions", () => {
  describe("audioMutedIds", () => {
    it("unions mute and block ids", () => {
      expect(audioMutedIds(set("a"), set("b"))).toEqual(new Set(["a", "b"]));
    });
    it("dedupes an id present in both sets", () => {
      expect(audioMutedIds(set("a"), set("a"))).toEqual(new Set(["a"]));
    });
    it("is empty when nothing is muted or blocked", () => {
      expect(audioMutedIds(set(), set())).toEqual(new Set());
    });
  });

  describe("isCommsSuppressed", () => {
    it("suppresses a locally-muted player", () => {
      expect(isCommsSuppressed("a", set("a"), set())).toBe(true);
    });
    it("suppresses a blocked player", () => {
      expect(isCommsSuppressed("b", set(), set("b"))).toBe(true);
    });
    it("leaves an unrelated player alone", () => {
      expect(isCommsSuppressed("z", set("a"), set("b"))).toBe(false);
    });
  });

  describe("isVideoHidden", () => {
    it("hides a blocked player's video", () => {
      expect(isVideoHidden("b", set("b"))).toBe(true);
    });
    it("does NOT hide video for a merely-muted player (mute keeps video)", () => {
      // Mute affects only audio/speaking/chat; the block set is what hides video.
      expect(isVideoHidden("a", set())).toBe(false);
    });
  });

  describe("filterSpeaking", () => {
    it("drops muted and blocked speakers, keeps the rest, preserving order", () => {
      expect(filterSpeaking(["a", "b", "c", "d"], set("b"), set("d"))).toEqual(["a", "c"]);
    });
    it("returns everyone when nothing is suppressed", () => {
      expect(filterSpeaking(["a", "b"], set(), set())).toEqual(["a", "b"]);
    });
    it("returns empty when all speakers are suppressed", () => {
      expect(filterSpeaking(["a", "b"], set("a"), set("b"))).toEqual([]);
    });
  });
});
