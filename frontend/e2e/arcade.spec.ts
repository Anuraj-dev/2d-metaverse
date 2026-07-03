import { test, expect } from "@playwright/test";
import { signUpAndJoin, walkTo } from "./helpers";

// The Snake cabinet sits at campus tile (70,50); its interactable zone covers
// the cabinet tile plus the three open tiles below it (rows 50-53, py 800-864).
// The 32px solid cabinet body ends at py 832, so row 53 (py≈856) is a
// collision-free approach strip INSIDE the zone: the player's physics body can
// never catch the cabinet's corner there (the round-1 flake), and both
// waypoints sit on verified-open plaza floor.
test("arcade: walk to a cabinet, open, play, and close", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });
  await page.locator(".game-canvas canvas").click();

  // Stage in open plaza below the cabinets, then move east along row 53 to
  // just under the Snake cabinet — inside its zone, clear of its solid body.
  await walkTo(page, 1050, 856, { tolerance: 12 });
  await walkTo(page, 1140, 856, { tolerance: 10 });

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

  // Escape closes instantly → close-arcade fires and the overlay unmounts.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    (window.__testHook?.state.events ?? []).some((e) => e.event === "close-arcade"),
  );
  await expect(page.locator(".arcade-overlay")).toBeHidden();

  // And the world actually resumed (the scene woke): the player can move
  // again — walkTo rides the positions ticks, which only flow while awake.
  await walkTo(page, 1080, 856, { tolerance: 12 });
});
