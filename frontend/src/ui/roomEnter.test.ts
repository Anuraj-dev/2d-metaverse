import { describe, it, expect } from "vitest";
import { roomEnterErrorMessage } from "./roomEnter";

describe("roomEnterErrorMessage", () => {
  it("explains a full room", () => {
    expect(roomEnterErrorMessage("full")).toMatch(/full/i);
  });

  it("explains rate limiting clearly", () => {
    expect(roomEnterErrorMessage("rate-limited")).toMatch(/too many|wait/i);
  });

  it("defaults to a wrong-key message", () => {
    expect(roomEnterErrorMessage("bad-key")).toMatch(/wrong key/i);
    expect(roomEnterErrorMessage(undefined)).toMatch(/wrong key/i);
  });
});
