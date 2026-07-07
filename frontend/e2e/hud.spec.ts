/**
 * PRD 20 HUD overhaul: the persistent chat panel is discoverable and usable
 * without the old Enter-to-open ritual, and collapses to a slim bar. (The
 * fullscreen-map open/close leg is added with PRD 20 part B.) Bus-hook + DOM only,
 * no sleeps — every wait is a locator condition.
 */
import { test, expect } from "@playwright/test";
import { signUpAndJoin } from "./helpers";

test("persistent chat panel: visible on join, sends, and collapses", async ({ page }) => {
  const user = await signUpAndJoin(page, { map: "campus" });

  // The panel is docked and visible immediately — no key press required.
  const panel = page.locator(".mc-chat");
  await expect(panel).toBeVisible();
  const input = panel.locator("form.mc-input input");
  await expect(input).toBeVisible();

  // Send straight through the always-present input; own line echoes back.
  const message = `hud hello ${user.username}`;
  await input.fill(message);
  await input.press("Enter");
  await expect(
    page.locator(".mc-list .mc-line").filter({ hasText: message }),
  ).toBeVisible();

  // Collapse to the slim bar; the transcript/input go away.
  await page.getByLabel("Collapse chat").click();
  await expect(page.locator(".mc-chat")).toBeHidden();
  const slim = page.locator(".mc-collapsed");
  await expect(slim).toBeVisible();

  // Re-expand from the slim bar.
  await slim.click();
  await expect(page.locator(".mc-chat")).toBeVisible();
});
