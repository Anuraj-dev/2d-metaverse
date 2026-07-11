import { describe, expect, it } from "vitest";
import { parseAuthFailureResponse } from "./auth-failure.js";

describe("parseAuthFailureResponse", () => {
  it("parses bounded outcomes without accepting extra or arbitrary fields", () => {
    expect(parseAuthFailureResponse({ error: "validation" })).toEqual({ error: "validation" });
    expect(
      parseAuthFailureResponse({ error: "rate-limited", retryAfterSeconds: 37 }),
    ).toEqual({ error: "rate-limited", retryAfterSeconds: 37 });
    expect(parseAuthFailureResponse({ error: "validation", details: "secret" })).toBeNull();
    expect(parseAuthFailureResponse({ error: "database exploded" })).toBeNull();
  });
});
