import { describe, expect, it } from "vitest";
import { isSuspended } from "../src/suspension.js";

const NOW = 1_000_000;

describe("isSuspended (PRD 25.14)", () => {
  it("is false when there is no suspension record", () => {
    expect(isSuspended(null, NOW)).toBe(false);
    expect(isSuspended(undefined, NOW)).toBe(false);
  });

  it("is true while the expiry is strictly in the future", () => {
    expect(isSuspended({ suspendedUntil: NOW + 1 }, NOW)).toBe(true);
    expect(isSuspended({ suspendedUntil: NOW + 60_000 }, NOW)).toBe(true);
  });

  it("is false once the expiry has been reached or passed (defence in depth)", () => {
    expect(isSuspended({ suspendedUntil: NOW }, NOW)).toBe(false);
    expect(isSuspended({ suspendedUntil: NOW - 1 }, NOW)).toBe(false);
  });
});
