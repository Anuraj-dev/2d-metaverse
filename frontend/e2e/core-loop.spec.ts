/**
 * User story 2: the core game loop is provably playable — signup, join the
 * world, keyboard movement, approach a door, get admitted (first arrival is the
 * room admin — no keys), door opens, sit, chat. Mirrors backend/test/smoke.mjs
 * through the real UI.
 */
import { test, expect } from "@playwright/test";
import {
  enterRoom,
  selfPosition,
  sendChat,
  signUpAndJoin,
  sitAtSeat,
  walkPath,
} from "./helpers";

// PRD 25.32: an open-plaza loop that borders the park trees repaired in this
// slice (tree footprints cleared back to grass so no trunk grows from concrete;
// the trunks stay solid wall tiles). Every waypoint is a collision-verified
// non-solid tile against the regenerated walls layer, and the loop ends at the
// hostel-descent handoff (560,704) — so this reuses the happy-path session for
// zero extra auth-limiter cost. Coordinates are tile*16 px (spawn tile (60,44)
// = px (960,704)).
const PLAZA_WALKABILITY_LOOP: [number, number][] = [
  [528, 704], // west along the E-W artery from spawn
  [528, 800], // south into the open plaza beside the repaired park trees
  [720, 800], // east across the plaza
  [560, 800], // back west
  [560, 704], // up to the hostel-descent handoff point
];

test("happy path: signup → join → move → door → enter → sit → chat", async ({ page }) => {
  const user = await signUpAndJoin(page, { map: "campus" });

  // Keyboard movement: hold ArrowRight until the bus reports displacement.
  await page.locator(".game-canvas canvas").click();
  const start = await selfPosition(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction((x0) => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    const positions = hook.state.last["positions"] as {
      players: { self: boolean; x: number }[];
    };
    return positions.players.find((p) => p.self)!.x > x0 + 16;
  }, start.x);
  await page.keyboard.up("ArrowRight");

  // PRD 25.32 walkability evidence: traverse the open plaza beside the repaired
  // park trees end-to-end, then confirm arrival at the descent handoff under the
  // avatar's own power — proving the plaza is clear and the tree-ground repair
  // did not perturb the collision grid.
  await walkPath(page, PLAZA_WALKABILITY_LOOP);
  const handoff = await selfPosition(page);
  expect(Math.hypot(handoff.x - 560, handoff.y - 704)).toBeLessThan(24);

  // Approach the hostel Room 1 door: the first arrival walks in as admin (no key).
  await enterRoom(page, "campus", "1");
  await expect(page.locator(".knock-status")).toBeHidden();

  // Walk to seat 0 and sit with E (held across the wait — see sitAtSeat).
  await sitAtSeat(page, "campus", "1");

  // Chat while seated; own message renders in the transcript as "<name> text".
  const message = `hello from ${user.username}`;
  await sendChat(page, message);
  await expect(
    page.locator(".mc-list .mc-line").filter({ hasText: message }),
  ).toBeVisible();
});
