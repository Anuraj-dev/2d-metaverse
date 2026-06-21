import { describe, expect, it } from "vitest";
import { parseSeatKey } from "../src/seat-key.js";

describe("seat key parsing", () => {
  it("parses valid Redis seat keys", () => {
    expect(parseSeatKey("seat:room-a:12")).toEqual({ roomId: "room-a", seatId: 12 });
  });

  it("rejects malformed keys", () => {
    expect(parseSeatKey("seat:room-a:nope")).toBeNull();
    expect(parseSeatKey("")).toBeNull();
  });
});
