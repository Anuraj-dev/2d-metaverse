import { describe, it, expect } from "vitest";
import { tabTrapTarget } from "./focusTrap";

describe("tabTrapTarget", () => {
  it("returns null for an empty set", () => {
    expect(tabTrapTarget(0, -1, false)).toBeNull();
    expect(tabTrapTarget(0, -1, true)).toBeNull();
  });

  it("advances forward through the interior", () => {
    expect(tabTrapTarget(3, 0, false)).toBe(1);
    expect(tabTrapTarget(3, 1, false)).toBe(2);
  });

  it("retreats backward through the interior on Shift+Tab", () => {
    expect(tabTrapTarget(3, 2, true)).toBe(1);
    expect(tabTrapTarget(3, 1, true)).toBe(0);
  });

  it("wraps from the last element to the first on Tab", () => {
    expect(tabTrapTarget(3, 2, false)).toBe(0);
  });

  it("wraps from the first element to the last on Shift+Tab", () => {
    expect(tabTrapTarget(3, 0, true)).toBe(2);
  });

  it("pulls focus back in when it has escaped the set (current -1)", () => {
    expect(tabTrapTarget(3, -1, false)).toBe(0);
    expect(tabTrapTarget(3, -1, true)).toBe(2);
  });

  it("treats an out-of-range current like an escape", () => {
    expect(tabTrapTarget(3, 9, false)).toBe(0);
    expect(tabTrapTarget(3, 9, true)).toBe(2);
  });

  it("keeps a single-element set on itself both directions", () => {
    expect(tabTrapTarget(1, 0, false)).toBe(0);
    expect(tabTrapTarget(1, 0, true)).toBe(0);
  });
});
