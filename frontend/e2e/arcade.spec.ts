import { test, expect } from "@playwright/test";
import { signUpAndJoin, walkTo } from "./helpers";

// The arcade cabinets now live inside the dedicated Arcade Room in the south
// campus (PRD 16). The room's north doorway aligns with the full-height x=79-80
// stone artery running down from spawn, so the route is: east onto the artery,
// straight south through coworking into the room, down to the open approach row
// (99), then across to a cabinet. The Flappy cabinet sits at tile (76,96) west of
// the doorway; its zone covers rows 96-99 and the collision-free approach is
// rows 98-99 (foot point fy = player.y + 8 lands inside px 1536-1600).
test("arcade: walk into the arcade room, open a cabinet, play, and close", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });
  await page.locator(".game-canvas canvas").click();

  // Onto the x=79 artery, then straight south into the room and down to row 99.
  await walkTo(page, 1272, 704, { tolerance: 12 });
  await walkTo(page, 1272, 1400, { tolerance: 12 });
  await walkTo(page, 1272, 1584, { tolerance: 12 });
  // Across the approach row to the Flappy cabinet.
  await walkTo(page, 1224, 1584, { tolerance: 12 });

  // Near the Flappy cabinet specifically.
  await page.waitForFunction(() => {
    const near = window.__testHook?.state.last["near-interactable"] as
      | { type?: string; payload?: { game?: string } }
      | undefined;
    return near?.type === "arcade" && near.payload?.game === "flappy";
  });

  // Press E → open-arcade → overlay mounts, world scene sleeps underneath.
  await page.keyboard.press("e");
  await page.waitForFunction(() => {
    const open = window.__testHook?.state.last["open-arcade"] as { game?: string } | undefined;
    return open?.game === "flappy";
  });
  await expect(page.locator(".arcade-overlay")).toBeVisible();
  await expect(page.locator(".arcade-leaderboard")).toBeVisible();
  // The new overlay chrome: per-arcade sound control + fullscreen toggle. The
  // overlay auto-requests browser fullscreen on open, so the toggle reports
  // "Exit fullscreen" when the request is granted (as in CI Chromium) and
  // "Enter fullscreen" when it is denied — match either state.
  await expect(page.locator(".arcade-sound")).toBeVisible();
  await expect(page.getByLabel("Mute arcade sound")).toBeVisible();
  await expect(page.getByLabel(/^(Enter|Exit) fullscreen$/)).toBeVisible();

  // Play a couple of inputs (flap); the overlay stays up.
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(page.locator(".arcade-overlay")).toBeVisible();

  // Escape closes instantly → close-arcade fires and the overlay unmounts.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    (window.__testHook?.state.events ?? []).some((e) => e.event === "close-arcade"),
  );
  await expect(page.locator(".arcade-overlay")).toBeHidden();

  // And the world actually resumed (the scene woke): the player can move again —
  // walkTo rides the positions ticks, which only flow while awake. Move along the
  // open floor below the cabinet row (rows 99-100), clear of the solid bodies.
  await walkTo(page, 1200, 1600, { tolerance: 16 });
});
