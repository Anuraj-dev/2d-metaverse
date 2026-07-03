import { test, expect } from "@playwright/test";
import { signUpAndJoin, walkPath, walkTo } from "./helpers";

// The Snake cabinet sits at campus tile (70,50); its 2x2 interactable zone is
// px (1120,800)-(1152,832). Tile (71,50)≈px(1144,808) is the open, walkable
// square beside it — inside the zone but off the solid cabinet body.
test("arcade: walk to a cabinet, open, play, and close", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });
  await page.locator(".game-canvas canvas").click();

  // East along the open plaza artery, then south into the Snake cabinet's zone
  // (x=1144 is tile 71, clear of the solid cabinet body at tile 70).
  await walkPath(page, [[1144, 704]]);
  await walkTo(page, 1144, 808, { tolerance: 22 });

  // Near the Snake cabinet specifically.
  await page.waitForFunction(() => {
    const near = window.__testHook?.state.last["near-interactable"] as
      | { type?: string; payload?: { game?: string } }
      | undefined;
    return near?.type === "arcade" && near.payload?.game === "snake";
  });

  // Press E → open-arcade → overlay mounts, world scene sleeps underneath.
  await page.keyboard.press("e");
  await page.waitForFunction(() => {
    const open = window.__testHook?.state.last["open-arcade"] as { game?: string } | undefined;
    return open?.game === "snake";
  });
  await expect(page.locator(".arcade-overlay")).toBeVisible();
  await expect(page.locator(".arcade-leaderboard")).toBeVisible();

  // Play a few inputs (steer the snake); the overlay stays up.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".arcade-overlay")).toBeVisible();

  // Escape closes instantly → overlay unmounts (and emits close-arcade,
  // waking the scene). Assert on the DOM HUD.
  await page.keyboard.press("Escape");
  await expect(page.locator(".arcade-overlay")).toBeHidden();
});
