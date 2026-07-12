import { describe, expect, it } from "vitest";
import { chatCooldownNotice, cooldownRetrySeconds } from "./chatCooldown";

describe("cooldownRetrySeconds", () => {
  it.each([
    [0, 1],
    [1, 1],
    [500, 1],
    [1000, 1],
    [1001, 2],
    [4000, 4],
    [4500, 5],
    [9999, 10],
  ])("rounds %dms up to %ds (never below 1)", (ms, seconds) => {
    expect(cooldownRetrySeconds(ms)).toBe(seconds);
  });
});

describe("chatCooldownNotice", () => {
  it("names the whole-second wait derived from retryAfterMs", () => {
    expect(chatCooldownNotice(4000)).toBe("You're sending messages too fast — wait 4s.");
    expect(chatCooldownNotice(3200)).toBe("You're sending messages too fast — wait 4s.");
    expect(chatCooldownNotice(0)).toBe("You're sending messages too fast — wait 1s.");
  });
});
