import { describe, it, expect } from "vitest";
import {
  seatTransition,
  doorTransition,
  type SeatEffect,
  type DoorState,
  type DoorEffect,
} from "./seatDoor";

describe("seatTransition — full matrix", () => {
  // [seated, action, hasSeat] → [nextSeated, effect]
  const matrix: Array<[boolean, "sit" | "stand", boolean, boolean, SeatEffect]> = [
    // sit
    [false, "sit", true, true, "sit"], // legal sit
    [false, "sit", false, false, null], // illegal: no seat under you
    [true, "sit", true, true, null], // illegal: already seated
    [true, "sit", false, true, null], // illegal: already seated, no seat
    // stand
    [true, "stand", false, false, "stand"], // legal stand
    [true, "stand", true, false, "stand"], // legal stand (seat availability irrelevant)
    [false, "stand", false, false, null], // illegal: already standing
    [false, "stand", true, false, null], // illegal: standing with a seat available
  ];
  it.each(matrix)(
    "seated=%s %s hasSeat=%s → seated=%s effect=%s",
    (seated, action, hasSeat, nextSeated, effect) => {
      expect(seatTransition(seated, action, hasSeat)).toEqual({
        seated: nextSeated,
        effect,
      });
    }
  );
});

describe("doorTransition — full matrix", () => {
  const matrix: Array<[DoorState, "enter" | "exit", DoorState, DoorEffect]> = [
    ["closed", "enter", "open", "open"], // legal open
    ["open", "enter", "open", null], // idempotent: already open
    ["open", "exit", "closed", "close"], // legal close
    ["closed", "exit", "closed", null], // idempotent: already closed
  ];
  it.each(matrix)("%s %s → %s effect=%s", (state, action, next, effect) => {
    expect(doorTransition(state, action)).toEqual({ state: next, effect });
  });
});
