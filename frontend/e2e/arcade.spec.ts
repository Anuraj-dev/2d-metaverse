import { test, expect } from "@playwright/test";
import { signUpAndJoin, walkTo } from "./helpers";

// The Snake cabinet sits at campus tile (70,50); its interactable zone covers
// the cabinet tile plus the three open tiles below it (px 800-864 vertically).
// Geometry of the target (1136, 846) ± tolerance 10:
//  - zone check uses the FOOT point fy = player.y + 8 → fy ∈ [844, 864], inside
//    the zone's 800-864 (the earlier rounds failed here: at y≈856 the foot
//    point sat exactly on/past the boundary);
//  - the player's physics body spans [y, y+14]; the cabinet's solid body ends
//    at py 832, so every y ≥ 836 approaches collision-free;
//  - x ∈ [1126, 1146] ⊂ zone x 1120-1152, and the whole approach row is
//    verified-open plaza floor.
test("arcade: walk to a cabinet, open, play, and close", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });
  await page.locator(".game-canvas canvas").click();

  // Stage in open plaza below the cabinets, then move east to just under the
  // Snake cabinet — inside its zone, clear of its solid body.
  await walkTo(page, 1050, 846, { tolerance: 10 });
  await walkTo(page, 1136, 846, { tolerance: 10 });

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
  await walkTo(page, 1080, 846, { tolerance: 10 });
});
