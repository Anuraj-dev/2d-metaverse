import { describe, it, expect } from "vitest";
import { micToastText, camToastText } from "./controlBar";

describe("control bar toggle copy", () => {
  it.each([
    [true, "Microphone on"],
    [false, "Microphone muted"],
  ])("mic on=%s -> %s", (on, text) => {
    expect(micToastText(on)).toBe(text);
  });

  it.each([
    [true, "Camera on"],
    [false, "Camera off"],
  ])("cam on=%s -> %s", (on, text) => {
    expect(camToastText(on)).toBe(text);
  });
});
