/**
 * Room access via knock/approve (PRD 14), across two browsers. Replaces the old
 * password-based room-security specs: there are no join secrets — the first arrival is the
 * admin, later arrivals knock, and the admin approves/denies (Google-Meet
 * model). Admin departure hands off to the next occupant (succession).
 *
 * Each test uses a DISTINCT room so a prior test's disconnect-grace teardown can
 * never leave a ghost admin in the room this test expects to be empty. LiveKit
 * tokens are refused in both contexts (as multiplayer/audio specs do) to avoid a
 * two-context RTC storm — media quality is out of scope here.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { enterRoom, knockAtDoor, respondToKnock, signUpAndJoin, uniqueUser } from "./helpers";

async function openContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.route("**/api/v1/livekit/token", (route) =>
    route.fulfill({ status: 403, json: { error: "e2e-media-disabled" } }),
  );
  const page = await context.newPage();
  await signUpAndJoin(page, { map: "campus", user: uniqueUser() });
  return { context, page };
}

test("admin approves a knock and the visitor gets in", async ({ browser }) => {
  const admin = await openContext(browser);
  const guest = await openContext(browser);
  try {
    // The first arrival walks straight into the empty room as its admin.
    await enterRoom(admin.page, "campus", "4");
    await expect(admin.page.locator(".admin-badge.is-you")).toBeVisible();

    // The visitor knocks and waits; the admin sees the request and approves.
    await knockAtDoor(guest.page, "campus", "4");
    await respondToKnock(admin.page, "Approve");

    // The approved visitor is admitted (door opens for them).
    await guest.page.waitForFunction(() => window.__testHook?.state.currentRoomId === "4");
    // The guest sees who the admin is; they are not the admin themselves.
    await expect(guest.page.locator(".admin-badge")).toContainText("Admin:");
  } finally {
    await admin.context.close();
    await guest.context.close();
  }
});

test("admin denies a knock and the visitor stays out", async ({ browser }) => {
  const admin = await openContext(browser);
  const guest = await openContext(browser);
  try {
    await enterRoom(admin.page, "campus", "5");
    await knockAtDoor(guest.page, "campus", "5");
    await respondToKnock(admin.page, "Deny");

    // The knocking card clears and feedback shows; the guest never entered.
    await expect(guest.page.locator(".knock-status-feedback")).toBeVisible();
    await guest.page.waitForFunction(() => window.__testHook?.state.knocking === null);
    const currentRoom = await guest.page.evaluate(() => window.__testHook?.state.currentRoomId ?? null);
    expect(currentRoom).toBeNull();
  } finally {
    await admin.context.close();
    await guest.context.close();
  }
});

test("adminship passes to the next occupant when the admin leaves", async ({ browser }) => {
  const admin = await openContext(browser);
  const heir = await openContext(browser);
  try {
    await enterRoom(admin.page, "campus", "6");
    await knockAtDoor(heir.page, "campus", "6");
    await respondToKnock(admin.page, "Approve");
    await heir.page.waitForFunction(() => window.__testHook?.state.currentRoomId === "6");
    // Before hand-off the heir is a plain occupant, not the admin.
    await expect(heir.page.locator(".admin-badge")).toContainText("Admin:");

    // The admin disconnects; after the grace window, succession promotes the heir.
    await admin.context.close();
    await expect(heir.page.locator(".admin-badge.is-you")).toBeVisible({ timeout: 20_000 });
  } finally {
    await heir.context.close();
    await admin.context.close().catch(() => undefined);
  }
});
