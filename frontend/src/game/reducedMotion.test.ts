import { describe, expect, it } from "vitest";
import {
  motionConfigMode,
  resolveReducedMotion,
  type ReducedMotionSetting,
} from "./reducedMotion";

describe("resolveReducedMotion", () => {
  // [setting, systemPrefersReduced, expected]
  const cases: Array<[ReducedMotionSetting, boolean, boolean]> = [
    ["system", false, false], // follow OS: no preference
    ["system", true, true], // follow OS: reduce
    ["on", false, true], // explicit ON overrides OS "no preference"
    ["on", true, true], // explicit ON agrees with OS
    ["off", true, false], // explicit OFF overrides OS "reduce"
    ["off", false, false], // explicit OFF agrees with OS
  ];

  it.each(cases)(
    "setting=%s system=%s -> %s",
    (setting, systemPrefersReduced, expected) => {
      expect(resolveReducedMotion(setting, systemPrefersReduced)).toBe(expected);
    },
  );
});

describe("motionConfigMode", () => {
  it("maps the resolved flag to a MotionConfig mode", () => {
    expect(motionConfigMode(true)).toBe("always");
    expect(motionConfigMode(false)).toBe("never");
  });
});
