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
  const currentRoom = await page.evaluate(() => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    return hook.state.currentRoomId;
  });
  expect(currentRoom).toBeNull();
});

test("cancelling the key prompt leaves the door impassable — no walk-in, no seat", async ({ page }) => {
  await signUpAndJoin(page, { map: "space" });
  await approachDoor(page, "space", "1");

  // Dismiss the prompt without a key, then try to barge straight north into the
  // room (space.json room "1": bounds y16-192, seat row near y96). The door has
  // no key, so the client gate must snap the avatar back at the doorway.
  await page.locator(".key-modal").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".key-modal")).toBeHidden();

  const outcome = await page.evaluate(
    () =>
      new Promise<{ minY: number; sawSeat: boolean; currentRoomId: string | null; seated: unknown }>(
        (resolve) => {
          const hook = window.__testHook;
          if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
          let minY = Infinity;
          let sawSeat = false;
          const deadline = Date.now() + 2500;
          const off = hook.on("positions", (payload) => {
            const self = (payload as { players: { self: boolean; x: number; y: number }[] }).players
              .find((p) => p.self);
            if (self) minY = Math.min(minY, self.y);
            if (hook.state.nearSeat) sawSeat = true;
            if (Date.now() < deadline) {
              hook.emit("move-axis", { x: 0, y: -1 }); // push north, into the room
            } else {
              hook.emit("move-axis", { x: 0, y: 0 });
              off();
              resolve({
                minY,
                sawSeat,
                currentRoomId: hook.state.currentRoomId,
                seated: hook.state.seated,
              });
            }
          });
        },
      ),
  );

  // The gate snaps the avatar back at the south wall (feet y=192 → player y≈184);
  // it must never reach the seat row (~y96) deep inside the room.
  expect(outcome.minY).toBeGreaterThan(176);
  expect(outcome.sawSeat).toBe(false);
  expect(outcome.currentRoomId).toBeNull();
  expect(outcome.seated).toBeNull();
});
