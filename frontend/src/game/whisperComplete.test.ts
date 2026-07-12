import { describe, expect, it } from "vitest";
import {
  whisperCompletion,
  whisperNameToken,
  type CompletionState,
} from "./whisperComplete";

const NAMES = ["bob", "bobby", "carol", "Bianca"];

describe("whisperNameToken", () => {
  it.each([
    ["/w ", ""],
    ["/w bo", "bo"],
    ["/whisper Ali", "Ali"],
    ["/msg x", "x"],
    ["/tell y", "y"],
  ])("extracts the partial name from %j", (text, token) => {
    expect(whisperNameToken(text)).toBe(token);
  });

  it.each([
    ["hello", "plain text"],
    ["/all hi", "a non-whisper command"],
    ["/w bob hi", "a completed name with a message body"],
    ["", "empty input"],
  ])("returns null for %j (%s)", (text) => {
    expect(whisperNameToken(text)).toBeNull();
  });
});

describe("whisperCompletion — Tab consumption gate", () => {
  it("returns null for non-whisper text so Tab falls through", () => {
    expect(whisperCompletion("hello", NAMES, null)).toBeNull();
    expect(whisperCompletion("/all hey", NAMES, null)).toBeNull();
    expect(whisperCompletion("", NAMES, null)).toBeNull();
  });

  it("returns null when no online name matches the partial", () => {
    expect(whisperCompletion("/w zzz", NAMES, null)).toBeNull();
    expect(whisperCompletion("/w bob", [], null)).toBeNull();
  });

  it("returns null once a full name plus a message body is typed", () => {
    // WHISPER_NAME_RE only matches a trailing single token, so "/w bob hi" is a
    // send, not a completion — Tab must not be hijacked mid-message.
    expect(whisperCompletion("/w bob hi", NAMES, null)).toBeNull();
  });

  it("completes the first prefix match on the first Tab", () => {
    const res = whisperCompletion("/w bo", NAMES, null);
    expect(res).toEqual({ text: "/w bob", state: { base: "bo", idx: 0 } });
  });

  it("is case-insensitive on both the command and the partial", () => {
    expect(whisperCompletion("/W BI", NAMES, null)).toEqual({
      text: "/W Bianca",
      state: { base: "BI", idx: 0 },
    });
  });

  it("preserves the exact command prefix (whitespace + verb) in the output", () => {
    expect(whisperCompletion("/tell  ca", NAMES, null)?.text).toBe("/tell  carol");
  });
});

describe("whisperCompletion — cycling", () => {
  it("cycles through every match against the fixed base, then wraps", () => {
    // base "b" matches bob, bobby, Bianca (in list order).
    let state: CompletionState | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = whisperCompletion(state ? "/w " + state.base : "/w b", NAMES, state);
      if (!res) throw new Error("expected a completion");
      seen.push(res.text);
      state = res.state;
    }
    // 3 matches, 4th press wraps back to the first.
    expect(seen).toEqual(["/w bob", "/w bobby", "/w Bianca", "/w bob"]);
  });

  it("holds the base steady even as the text reflects the last completion", () => {
    // After the first completion the input text is "/w bob", but passing the
    // prior cursor keeps cycling the original "b" base rather than re-narrowing.
    const first = whisperCompletion("/w b", NAMES, null);
    expect(first?.state.base).toBe("b");
    const second = whisperCompletion("/w bob", NAMES, first?.state ?? null);
    expect(second).toEqual({ text: "/w bobby", state: { base: "b", idx: 1 } });
  });
});
