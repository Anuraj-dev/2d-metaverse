import { describe, it, expect } from "vitest";
import {
  throttleReady,
  POSITIONS_INTERVAL_MS,
  MOVE_SEND_INTERVAL_MS,
} from "./throttle";

describe("throttleReady", () => {
  const cases: Array<[string, number, number, number, boolean]> = [
    ["not due just after an emit", 10, 0, 66, false],
    ["not due one ms before the interval", 65, 0, 66, false],
    ["due exactly at the interval", 66, 0, 66, true],
    ["due after the interval", 200, 0, 66, true],
    ["due on first call with last=0 and now past interval", 1000, 0, 66, true],
    ["respects a non-zero last timestamp", 130, 100, 66, false],
    ["fires again once the interval passes from last", 170, 100, 66, true],
  ];
  it.each(cases)("%s", (_l, now, last, interval, due) => {
    expect(throttleReady(now, last, interval)).toBe(due);
  });

  it("exports the scene cadences", () => {
    expect(POSITIONS_INTERVAL_MS).toBe(66);
    expect(MOVE_SEND_INTERVAL_MS).toBe(80);
  });
});
