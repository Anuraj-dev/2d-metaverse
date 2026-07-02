import { describe, it, expect } from "vitest";
import { parseInteractables, findNear, type InteractableDef } from "./interactables";

describe("parseInteractables", () => {
  it("returns [] for empty input", () => {
    expect(parseInteractables([])).toEqual([]);
  });

  it("skips objects without interactType property", () => {
    expect(parseInteractables([{ name: "tree", properties: [] }])).toEqual([]);
  });

  it("skips objects with an unknown interactType value", () => {
    expect(
      parseInteractables([{
        name: "ufo",
        properties: [{ name: "interactType", value: "ufo" }],
      }])
    ).toEqual([]);
  });

  it("parses a portal with numeric payload", () => {
    const result = parseInteractables([{
      name: "portal_east",
      x: 432, y: 688, width: 32, height: 32,
      properties: [
        { name: "interactType", value: "portal" },
        { name: "label", value: "Shortcut East" },
        { name: "targetX", value: 1280 },
        { name: "targetY", value: 688 },
      ],
    }]);
    expect(result).toHaveLength(1);
    const [p] = result;
    if (!p) throw new Error("expected one parsed interactable");
    expect(p.type).toBe("portal");
    expect(p.id).toBe("portal_east");
    expect(p.label).toBe("Shortcut East");
    expect(p.rect).toEqual({ x: 432, y: 688, w: 32, h: 32 });
    expect(p.payload).toEqual({ targetX: 1280, targetY: 688 });
  });

  it("parses an info board with string content", () => {
    const result = parseInteractables([{
      name: "board_plaza",
      x: 256, y: 608, width: 32, height: 32,
      properties: [
        { name: "interactType", value: "info" },
        { name: "label", value: "Campus Info" },
        { name: "content", value: "Welcome!" },
      ],
    }]);
    const [board] = result;
    if (!board) throw new Error("expected one parsed interactable");
    expect(board.type).toBe("info");
    expect(board.payload.content).toBe("Welcome!");
  });

  it("falls back to object name when label property is absent", () => {
    const result = parseInteractables([{
      name: "my_whiteboard",
      properties: [{ name: "interactType", value: "whiteboard" }],
    }]);
    const [whiteboard] = result;
    if (!whiteboard) throw new Error("expected one parsed interactable");
    expect(whiteboard.label).toBe("my_whiteboard");
  });

  it("excludes interactType and label from payload", () => {
    const result = parseInteractables([{
      name: "p",
      properties: [
        { name: "interactType", value: "portal" },
        { name: "label", value: "X" },
        { name: "targetX", value: 100 },
      ],
    }]);
    const [portal] = result;
    if (!portal) throw new Error("expected one parsed interactable");
    expect(portal.payload).not.toHaveProperty("interactType");
    expect(portal.payload).not.toHaveProperty("label");
    expect(portal.payload.targetX).toBe(100);
  });
});

describe("findNear", () => {
  const ia: InteractableDef = {
    id: "a",
    label: "A",
    type: "info",
    rect: { x: 100, y: 200, w: 32, h: 32 },
    payload: {},
  };

  it("returns null for empty list", () => {
    expect(findNear([], 115, 215)).toBeNull();
  });

  it("returns null when player is outside rect (x axis)", () => {
    expect(findNear([ia], 50, 215)).toBeNull();
    expect(findNear([ia], 200, 215)).toBeNull();
  });

  it("returns null when player is outside rect (y axis)", () => {
    expect(findNear([ia], 115, 50)).toBeNull();
    expect(findNear([ia], 115, 300)).toBeNull();
  });

  it("returns the interactable when player is inside rect", () => {
    expect(findNear([ia], 116, 216)).toBe(ia);
  });

  it("matches at rect top-left corner (inclusive)", () => {
    expect(findNear([ia], 100, 200)).toBe(ia);
  });

  it("matches at rect bottom-right corner (inclusive)", () => {
    expect(findNear([ia], 132, 232)).toBe(ia);
  });

  it("returns first match when multiple interactables overlap position", () => {
    const ia2: InteractableDef = { ...ia, id: "b", label: "B" };
    expect(findNear([ia, ia2], 116, 216)).toBe(ia);
  });
});
