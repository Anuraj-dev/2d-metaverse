/**
 * User story 2: the core game loop is provably playable — signup, join the
 * world, keyboard movement, approach a door, enter the room key, door opens,
 * sit, chat. Mirrors backend/test/smoke.mjs through the real UI.
 */
import { test, expect } from "@playwright/test";
import { enterRoom, selfPosition, sendChat, signUpAndJoin, sitAtSeat } from "./helpers";

test("happy path: signup → join → move → door → key → sit → chat", async ({ page }) => {
  const user = await signUpAndJoin(page, { map: "space" });

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

  // Approach the Meeting Room A door and enter with the correct key.
  await enterRoom(page, "space", "1");
  await expect(page.locator(".key-modal")).toBeHidden();

  // Walk to seat 0 and sit with E (held across the wait — see sitAtSeat).
  await sitAtSeat(page, "space", "1");

  // Chat while seated; own message renders in the transcript as "<name> text".
  const message = `hello from ${user.username}`;
  await sendChat(page, message);
  await expect(
    page.locator(".mc-log .mc-line").filter({ hasText: message }),
  ).toBeVisible();
});
