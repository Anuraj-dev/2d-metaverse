import { describe, it, expect } from "vitest";
import { mediaFailureText } from "./controlBar";

describe("bounded media-failure copy (PRD 25.7)", () => {
  it.each([
    ["mic", "denied", "Microphone blocked — allow access in your browser"],
    ["mic", "unavailable", "No microphone found"],
    ["mic", "failed", "Couldn't turn on the microphone"],
    ["cam", "denied", "Camera blocked — allow access in your browser"],
    ["cam", "unavailable", "No camera found"],
    ["cam", "failed", "Couldn't turn on the camera"],
  ] as const)("%s %s -> %s", (device, failure, text) => {
    expect(mediaFailureText(device, failure)).toBe(text);
  });
});
