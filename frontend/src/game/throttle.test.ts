import { describe, it, expect } from "vitest";
import {
  positionsEmitDue,
  moveSendDue,
  POSITIONS_INTERVAL_MS,
  MOVE_SEND_INTERVAL_MS,
} from "./throttle";

describe("positionsEmitDue (inclusive 66ms boundary)", () => {
  const cases: Array<[string, number, number, boolean]> = [
    ["not due just after an emit", 10, 0, false],
    ["not due one ms before the interval", 65, 0, false],
    ["due exactly at the interval (inclusive)", 66, 0, true],
    ["due after the interval", 200, 0, true],
    ["respects a non-zero last timestamp", 130, 100, false],
    ["fires again once the interval passes from last", 166, 100, true],
  ];
  it.each(cases)("%s", (_l, now, last, due) => {
    expect(positionsEmitDue(now, last)).toBe(due);
  });
});

describe("moveSendDue (strict 80ms boundary)", () => {
  const cases: Array<[string, number, number, boolean]> = [
    ["not due just after a send", 10, 0, false],
    // Strict boundary: four exact 20ms frames on a 50Hz display land on 80ms —
    // still NOT due; the send happens on the next frame (100ms).
    ["NOT due at exactly the interval", 80, 0, false],
    ["due just past the interval", 80.01, 0, true],
    ["due well after the interval", 200, 0, true],
    ["not due at exactly last+80 with a non-zero last", 180, 100, false],
    ["fires strictly past last+80", 181, 100, true],
  ];
  it.each(cases)("%s", (_l, now, last, due) => {
    expect(moveSendDue(now, last)).toBe(due);
  });
});

describe("cadence constants", () => {
  it("exports the scene cadences", () => {
    expect(POSITIONS_INTERVAL_MS).toBe(66);
    expect(MOVE_SEND_INTERVAL_MS).toBe(80);
  });
});
