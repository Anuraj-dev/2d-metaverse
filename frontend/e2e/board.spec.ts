/**
 * Board tables (PRD 11 phase 2): two players sit at opposite seats of the
 * tic-tac-toe table, accept the match, and play to a decided win. Assertions go
 * through the DOM board panel + the bus hook only — never the Phaser canvas,
 * never network internals (the backend suite owns move validation).
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpAndJoin, sitAtBoard, uniqueUser } from "./helpers";

/** Click cell `i` on a panel once it becomes playable (that player's turn). */
async function playCell(panel: Locator, i: number): Promise<void> {
  const cell = panel.locator(".board-cell").nth(i);
  await expect(cell).toBeEnabled({ timeout: 20_000 });
  await cell.click();
}

async function panelOf(page: Page): Promise<Locator> {
  const panel = page.locator(".board-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

test("two players complete a tic-tac-toe match to a decided win", async ({ browser }) => {
  test.setTimeout(120_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  // Media is out of scope; refuse LiveKit tokens so the RTC reconnect storm
  // doesn't starve the two Phaser loops (same guard as multiplayer.spec).
  for (const context of [contextA, contextB]) {
    await context.route("**/api/v1/livekit/token", (route) =>
      route.fulfill({ status: 403, json: { error: "e2e-media-disabled" } }),
    );
  }
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await signUpAndJoin(pageA, { map: "campus", user: uniqueUser() });
    await signUpAndJoin(pageB, { map: "campus", user: uniqueUser() });

    // Sit at opposite seats (A = seat 0 = plays first, B = seat 1).
    await sitAtBoard(pageA, "ttt-1", 0);
    await sitAtBoard(pageB, "ttt-1", 1);

    const panelA = await panelOf(pageA);
    const panelB = await panelOf(pageB);

    // Both seats accept → the match starts.
    await panelA.getByRole("button", { name: "Accept match" }).click();
    await panelB.getByRole("button", { name: "Accept match" }).click();

    // A wins the top row (cells 0,1,2); B answers in 3,4 between.
    await playCell(panelA, 0);
    await playCell(panelB, 3);
    await playCell(panelA, 1);
    await playCell(panelB, 4);
    await playCell(panelA, 2);

    await expect(panelA.locator(".board-panel__status")).toHaveText("You win!", { timeout: 20_000 });
    await expect(panelB.locator(".board-panel__status")).toHaveText("You lose", { timeout: 20_000 });
    // The winning line is highlighted for both viewers.
    await expect(panelA.locator(".board-cell.win")).toHaveCount(3);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
