/**
 * User story 5: the named regression for the prod doors incident — all six
 * rooms exist and every door functions (opens with its key) through the real
 * UI. Rooms 1-3 live on the default `space` map, rooms 4-6 on `?map=campus`;
 * the world-info payloads of both maps must cover ids 1..6 between them.
 */
import { test, expect } from "@playwright/test";
import { enterRoom, MAPS, signUpAndJoin, signInAndJoin, uniqueUser, walkTo } from "./helpers";

async function roomIdsFromWorldInfo(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const info = window.__testHook!.state.last["world-info"] as {
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
    const [exitX, exitY] = MAPS.space.rooms[roomId].exit;
    await walkTo(page, exitX, exitY);
    await page.waitForFunction(() => window.__testHook?.state.currentRoomId === null);
  }

  // --- campus map: rooms 4-6 (same user, fresh page load) ---
  await signInAndJoin(page, user, { map: "campus" });
  expect(await roomIdsFromWorldInfo(page)).toEqual(["4", "5", "6"]);

  for (const roomId of ["4", "5", "6"] as const) {
    await enterRoom(page, "campus", roomId);
    const [exitX, exitY] = MAPS.campus.rooms[roomId].exit;
    await walkTo(page, exitX, exitY);
    await page.waitForFunction(() => window.__testHook?.state.currentRoomId === null);
  }
});
