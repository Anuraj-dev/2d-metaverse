/**
 * User story 3: the room-security UX in the browser — wrong key shows the
 * error copy, repeated wrong keys hit the rate limit (per player+room, so a
 * fresh signup per test keeps runs isolated).
 */
import { test, expect } from "@playwright/test";
import { approachDoor, signUpAndJoin, submitRoomKey } from "./helpers";

test("wrong key shows error; repeated attempts hit the rate limit", async ({ page }) => {
  await signUpAndJoin(page, { map: "space" });
  await approachDoor(page, "space", "1");

  // Wrong key → inline error, modal stays open, still outside the room.
  await submitRoomKey(page, "not-the-key");
  await expect(page.locator(".key-error")).toHaveText("Wrong key, try again.");
  await expect(page.locator(".key-modal")).toBeVisible();

  // Backend allows ROOM_KEY_ATTEMPT_LIMIT (5) attempts per window; the 6th
  // returns rate-limited. Attempts 2-5 keep reporting the wrong-key error.
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    await submitRoomKey(page, `still-wrong-${attempt}`);
    await expect(page.locator(".key-error")).toHaveText("Wrong key, try again.");
  }
  await submitRoomKey(page, "one-too-many");
  await expect(page.locator(".key-error")).toHaveText(
    "Too many attempts — please wait a moment and try again.",
  );

  // Never entered the room.
  const currentRoom = await page.evaluate(() => window.__testHook!.state.currentRoomId);
  expect(currentRoom).toBeNull();
});
