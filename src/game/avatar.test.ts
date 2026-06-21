import { describe, it, expect } from "vitest";
import { idleFrame, walkAnim } from "./avatar";

describe("avatar frame mapping", () => {
  it("maps each direction to the middle (idle) frame of its row", () => {
    // sheet rows: down=0, left=1, right=2, up=3; 3 cols each; middle col = idx 1
    expect(idleFrame("down")).toBe(1);
    expect(idleFrame("left")).toBe(4);
    expect(idleFrame("right")).toBe(7);
    expect(idleFrame("up")).toBe(10);
  });

  it("builds a stable walk-animation key", () => {
    expect(walkAnim("char1", "down")).toBe("char1-walk-down");
    expect(walkAnim("char3", "up")).toBe("char3-walk-up");
  });
});
