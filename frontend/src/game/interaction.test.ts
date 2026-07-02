import { describe, it, expect } from "vitest";
import { interactAction, type InteractAction } from "./interaction";

describe("interactAction — full priority matrix", () => {
  const matrix: Array<[boolean, boolean, InteractAction]> = [
    // seated wins over everything: E always stands up first
    [true, true, "stand"],
    [true, false, "stand"],
    // standing near an interactable: interact beats sit
    [false, true, "interact"],
    // standing in the open: fall through to sit (no-op without a seat)
    [false, false, "sit"],
  ];
  it.each(matrix)("seated=%s hasInteractable=%s → %s", (seated, ia, action) => {
    expect(interactAction(seated, ia)).toBe(action);
  });
});
