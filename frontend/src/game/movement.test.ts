import { describe, it, expect } from "vitest";
import {
  movementIntent,
  BASE_SPEED,
  RUN_MULTIPLIER,
  type MovementInput,
} from "./movement";
import type { Dir } from "@metaverse/shared";

const NONE = { x: 0, y: 0 };
function keys(part: Partial<MovementInput>): MovementInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    run: false,
    touchAxis: NONE,
    ...part,
  };
}

describe("movementIntent — velocity", () => {
  const S = BASE_SPEED;
  const cases: Array<[string, Partial<MovementInput>, number, number]> = [
    ["idle", {}, 0, 0],
    ["left", { left: true }, -S, 0],
    ["right", { right: true }, S, 0],
    ["up", { up: true }, 0, -S],
    ["down", { down: true }, 0, S],
    ["opposite keys cancel", { left: true, right: true }, 0, 0],
  ];
  it.each(cases)("%s", (_label, part, vx, vy) => {
    const r = movementIntent(keys(part), "down");
    expect(r.vx).toBeCloseTo(vx);
    expect(r.vy).toBeCloseTo(vy);
  });

  it("clamps diagonal speed to the base speed (no faster diagonals)", () => {
    const r = movementIntent(keys({ right: true, down: true }), "down");
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(S);
    expect(r.vx).toBeCloseTo(S / Math.SQRT2);
    expect(r.vy).toBeCloseTo(S / Math.SQRT2);
  });

  it("applies the run multiplier when sprinting", () => {
    const r = movementIntent(keys({ right: true, run: true }), "down");
    expect(r.vx).toBeCloseTo(S * RUN_MULTIPLIER);
  });

  it("respects a custom base speed", () => {
    const r = movementIntent(keys({ right: true }), "down", 300);
    expect(r.vx).toBeCloseTo(300);
  });
});

describe("movementIntent — facing", () => {
  const cases: Array<[Partial<MovementInput>, Dir]> = [
    [{ left: true }, "left"],
    [{ right: true }, "right"],
    [{ up: true }, "up"],
    [{ down: true }, "down"],
    // the vertical axis wins ties (dominant-axis test is a strict `abs(vx) > abs(vy)`)
    [{ right: true, down: true }, "down"],
    [{ left: true, up: true }, "up"],
  ];
  it.each(cases)("%o → %s", (part, dir) => {
    expect(movementIntent(keys(part), "down").dir).toBe(dir);
  });

  it("keeps the current facing while idle", () => {
    expect(movementIntent(keys({}), "up").dir).toBe("up");
    expect(movementIntent(keys({ left: true, right: true }), "left").dir).toBe("left");
  });
});

describe("movementIntent — moving flag", () => {
  it("is false when idle", () => {
    expect(movementIntent(keys({}), "down").moving).toBe(false);
  });
  it("is true when a direction is pressed", () => {
    expect(movementIntent(keys({ up: true }), "down").moving).toBe(true);
  });
});

describe("movementIntent — joystick", () => {
  it("overrides keyboard when engaged", () => {
    const r = movementIntent(keys({ left: true, touchAxis: { x: 1, y: 0 } }), "down");
    expect(r.vx).toBeCloseTo(BASE_SPEED);
    expect(r.dir).toBe("right");
  });

  it("supports fractional joystick magnitudes below full speed", () => {
    const r = movementIntent(keys({ touchAxis: { x: 0.5, y: 0 } }), "down");
    expect(r.vx).toBeCloseTo(BASE_SPEED * 0.5);
    expect(r.moving).toBe(true);
  });

  it("is ignored when at rest (0,0) so keyboard still reads", () => {
    const r = movementIntent(keys({ down: true, touchAxis: { x: 0, y: 0 } }), "up");
    expect(r.vy).toBeCloseTo(BASE_SPEED);
    expect(r.dir).toBe("down");
  });
});
