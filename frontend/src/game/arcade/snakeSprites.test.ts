import { describe, it, expect } from "vitest";
import {
  FOOD_TILE,
  SNAKE_TILE_COUNT,
  WALL_TILE,
  dirBetween,
  snakeTileIndex,
} from "./snakeSprites";
import type { Cell, Dir } from "./snake";

describe("dirBetween", () => {
  const cases: Array<{ to: Cell; dir: Dir | null }> = [
    { to: { x: 6, y: 5 }, dir: "right" },
    { to: { x: 4, y: 5 }, dir: "left" },
    { to: { x: 5, y: 6 }, dir: "down" },
    { to: { x: 5, y: 4 }, dir: "up" },
    { to: { x: 7, y: 5 }, dir: null },
    { to: { x: 6, y: 6 }, dir: null },
    { to: { x: 5, y: 5 }, dir: null },
  ];
  for (const { to, dir } of cases) {
    it(`(5,5) → (${to.x},${to.y}) is ${dir ?? "not adjacent"}`, () => {
      expect(dirBetween({ x: 5, y: 5 }, to)).toBe(dir);
    });
  }
});

describe("snakeTileIndex", () => {
  it("keeps every index inside the sheet", () => {
    const body: Cell[] = [
      { x: 5, y: 2 },
      { x: 4, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
    ];
    for (let i = 0; i < body.length; i++) {
      const tile = snakeTileIndex(body, i, "right");
      expect(tile).toBeGreaterThanOrEqual(0);
      expect(tile).toBeLessThan(SNAKE_TILE_COUNT);
    }
    expect(FOOD_TILE).toBeLessThan(SNAKE_TILE_COUNT);
    expect(WALL_TILE).toBeLessThan(SNAKE_TILE_COUNT);
  });

  const headCases: Array<{ dir: Dir; neck: Cell; tile: number }> = [
    { dir: "right", neck: { x: 4, y: 5 }, tile: 0 },
    { dir: "down", neck: { x: 5, y: 4 }, tile: 1 },
    { dir: "left", neck: { x: 6, y: 5 }, tile: 2 },
    { dir: "up", neck: { x: 5, y: 6 }, tile: 3 },
  ];
  for (const { dir, neck, tile } of headCases) {
    it(`head facing ${dir} uses tile ${tile}`, () => {
      expect(snakeTileIndex([{ x: 5, y: 5 }, neck], 0, dir)).toBe(tile);
    });
  }

  it("falls back to the moved direction for a length-1 snake", () => {
    expect(snakeTileIndex([{ x: 5, y: 5 }], 0, "up")).toBe(3);
  });

  const tailCases: Array<{ name: string; toHead: Cell; tile: number }> = [
    { name: "body continues right", toHead: { x: 6, y: 5 }, tile: 10 },
    { name: "body continues down", toHead: { x: 5, y: 6 }, tile: 11 },
    { name: "body continues left", toHead: { x: 4, y: 5 }, tile: 12 },
    { name: "body continues up", toHead: { x: 5, y: 4 }, tile: 13 },
  ];
  for (const { name, toHead, tile } of tailCases) {
    it(`tail where the ${name} uses tile ${tile}`, () => {
      // [head, tail]: index 1 is the tail.
      expect(snakeTileIndex([toHead, { x: 5, y: 5 }], 1, "right")).toBe(tile);
    });
  }

  // Middle segment: [prev(head side), cell, next(tail side)].
  const midCases: Array<{ name: string; prev: Cell; next: Cell; tile: number }> = [
    { name: "straight horizontal", prev: { x: 6, y: 5 }, next: { x: 4, y: 5 }, tile: 4 },
    { name: "straight horizontal (reversed)", prev: { x: 4, y: 5 }, next: { x: 6, y: 5 }, tile: 4 },
    { name: "straight vertical", prev: { x: 5, y: 4 }, next: { x: 5, y: 6 }, tile: 5 },
    { name: "bend up+right", prev: { x: 5, y: 4 }, next: { x: 6, y: 5 }, tile: 6 },
    { name: "bend up+right (mirrored)", prev: { x: 6, y: 5 }, next: { x: 5, y: 4 }, tile: 6 },
    { name: "bend right+down", prev: { x: 6, y: 5 }, next: { x: 5, y: 6 }, tile: 7 },
    { name: "bend down+left", prev: { x: 5, y: 6 }, next: { x: 4, y: 5 }, tile: 8 },
    { name: "bend left+up", prev: { x: 4, y: 5 }, next: { x: 5, y: 4 }, tile: 9 },
    { name: "bend left+up (mirrored)", prev: { x: 5, y: 4 }, next: { x: 4, y: 5 }, tile: 9 },
  ];
  for (const { name, prev, next, tile } of midCases) {
    it(`${name} uses tile ${tile}`, () => {
      expect(snakeTileIndex([prev, { x: 5, y: 5 }, next], 1, "right")).toBe(tile);
    });
  }

  it("degrades gracefully on a non-adjacent or missing segment", () => {
    expect(snakeTileIndex([], 0, "right")).toBe(4);
    // Teleported segment (never produced by the reducer) still returns a valid tile.
    expect(
      snakeTileIndex([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }], 1, "right")
    ).toBe(4);
  });

  it("renders a full path with the head, bends and tail in the right order", () => {
    // Path: head (7,2) ← (6,2) ← (5,2) ← (4,2) ↓ (4,3) ↓ (4,4) → (5,4) → (6,4) ↓ tail (6,5)
    const body: Cell[] = [
      { x: 7, y: 2 },
      { x: 6, y: 2 },
      { x: 5, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 5 },
    ];
    const tiles = body.map((_, i) => snakeTileIndex(body, i, "right"));
    expect(tiles).toEqual([0, 4, 4, 7, 5, 6, 4, 8, 13]);
  });
});
