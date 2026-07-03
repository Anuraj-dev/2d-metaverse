/**
 * User story 5: the named regression for the prod doors incident — all six
 * rooms exist and every door functions (opens with its key) through the real
 * UI. Rooms 1-3 live on the legacy `space` map (`?map=space`), rooms 4-6 on
 * the default `campus` map; the world-info payloads of both maps must cover
 * ids 1..6 between them.
 */
import { test, expect } from "@playwright/test";
import { enterRoom, MAPS, signUpAndJoin, signInAndJoin, uniqueUser, walkTo } from "./helpers";

async function roomIdsFromWorldInfo(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    const info = hook.state.last["world-info"] as {
      rooms: { id: string }[];
    };
    return info.rooms.map((room) => room.id).sort();
  });
}

test("all six rooms exist with functioning doors", async ({ page }) => {
  test.setTimeout(180_000);
  const user = uniqueUser();

  // --- space map: rooms 1-3 ---
  await signUpAndJoin(page, { map: "space", user });
  expect(await roomIdsFromWorldInfo(page)).toEqual(["1", "2", "3"]);

  for (const roomId of ["1", "2", "3"] as const) {
    await enterRoom(page, "space", roomId);
    // Step back out so the next door can trigger (fires room-left).
    const route = MAPS.space.rooms[roomId];
    if (!route) throw new Error(`no route for space room "${roomId}"`);
    const [exitX, exitY] = route.exit;
    await walkTo(page, exitX, exitY);
    await page.waitForFunction(() => window.__testHook?.state.currentRoomId === null);
  }

  // --- campus map: rooms 4-6 (same user, fresh page load) ---
  await signInAndJoin(page, user, { map: "campus" });
  expect(await roomIdsFromWorldInfo(page)).toEqual(["4", "5", "6"]);

  for (const roomId of ["4", "5", "6"] as const) {
    await enterRoom(page, "campus", roomId);
    const route = MAPS.campus.rooms[roomId];
    if (!route) throw new Error(`no route for campus room "${roomId}"`);
    const [exitX, exitY] = route.exit;
    await walkTo(page, exitX, exitY);
    await page.waitForFunction(() => window.__testHook?.state.currentRoomId === null);
  }
});
