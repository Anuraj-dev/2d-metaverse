import { test, expect } from "@playwright/test";
import { signUpAndJoin, walkTo } from "./helpers";

// The Snake cabinet sits at campus tile (70,50); its interactable zone spans the
// cabinet tile plus the two open tiles below it (rows 51-52). Row 52 (py≈840) is
// fully clear of every solid cabinet body, so we stage in open plaza south-west
// of the cabinets and steer east along that row until the zone fires — robust to
// the exact pixel where we settle.
test("arcade: walk to a cabinet, open, play, and close", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });
  await page.locator(".game-canvas canvas").click();

  // Stage in open plaza (tile ~65,52), south-west of and below the cabinets.
  await walkTo(page, 1050, 840, { tolerance: 20 });

  // Steer east along the clear row until we enter the Snake cabinet's zone.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const hook = window.__testHook;
        if (!hook) throw new Error("E2E test hook missing (build with VITE_E2E_HOOK=1)");
        const stop = () => hook.emit("move-axis", { x: 0, y: 0 });
        const timer = setTimeout(() => {
          off();
          stop();
          reject(new Error("never reached the Snake cabinet zone"));
        }, 15000);
        const off = hook.on("positions", () => {
          const near = hook.state.last["near-interactable"] as
            | { type?: string; payload?: { game?: string } }
            | undefined;
          if (near?.type === "arcade" && near.payload?.game === "snake") {
            clearTimeout(timer);
            off();
            stop();
            resolve();
            return;
          }
          hook.emit("move-axis", { x: 0.6, y: 0 });
        });
      }),
  );

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
