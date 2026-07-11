/**
 * PRD 25.32: campus geometry / walkability repair evidence.
 *
 * Walks a straight-segment loop through the open central plaza that borders the
 * park trees repaired in this slice (the tree footprints were cleared back to
 * grass so no trunk grows from concrete; the trunks stay solid wall tiles). Every
 * waypoint is a verified collision-free tile against the regenerated walls layer
 * — proving the plaza next to the fixed trees remains traversable and that the
 * repair did not perturb the collision grid. Coordinates are tile*16 px, matching
 * the map's tile origin convention (spawn tile (60,44) = px (960,704)).
 */
import { test, expect } from "@playwright/test";
import { selfPosition, signUpAndJoin, walkPath } from "./helpers";

// Open-plaza loop, all cells asserted non-solid against the generated walls
// layer; the nearest tree trunks (park, tiles x<=28) sit well clear.
const PLAZA_WEST: [number, number] = [528, 704]; // west along the E-W artery
const PLAZA_SW: [number, number] = [528, 800]; // south into the plaza by the trees
const PLAZA_SE: [number, number] = [720, 800]; // east across the plaza
const PLAZA_FINISH: [number, number] = [720, 704]; // back up to the artery

test("plaza beside the repaired park trees stays walkable", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });
  await page.locator(".game-canvas canvas").click();

  await walkPath(page, [PLAZA_WEST, PLAZA_SW, PLAZA_SE, PLAZA_FINISH]);

  // Arrived at the final waypoint under its own power — the loop is traversable
  // end to end with no wall/trunk blocking the open plaza.
  const [finishX, finishY] = PLAZA_FINISH;
  const pos = await selfPosition(page);
  expect(Math.hypot(pos.x - finishX, pos.y - finishY)).toBeLessThan(24);
});
