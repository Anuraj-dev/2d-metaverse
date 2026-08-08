import { describe, expect, it } from "vitest";
import { createFx, shakeOffset, startGameOverFx } from "./fx";

describe("Snake death shake", () => {
  it("returns no offset when shake is disabled", () => {
    const fx = createFx();
    startGameOverFx(fx);
    expect(shakeOffset(fx, 20, false)).toEqual({ x: 0, y: 0 });
  });
});
