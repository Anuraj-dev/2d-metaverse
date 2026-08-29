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
  it("parses field validation and suspension without accepting extra data", () => {
    expect(parseAuthFailureResponse({ error: "validation", field: "username", reason: "invalid-characters" }))
      .toEqual({ error: "validation", field: "username", reason: "invalid-characters" });
    expect(parseAuthFailureResponse({ error: "suspended", until: 1_800_000_000_000 }))
      .toEqual({ error: "suspended", until: 1_800_000_000_000 });
    expect(parseAuthFailureResponse({ error: "validation", field: "password", reason: "invalid-characters" }))
      .toBeNull();
    expect(parseAuthFailureResponse({ error: "suspended", until: 8_640_000_000_000_001 })).toBeNull();
    expect(parseAuthFailureResponse({ error: "suspended", until: 1_800_000_000_000, reason: "secret" })).toBeNull();
  });
});
