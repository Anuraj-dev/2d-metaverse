/**
 * PRD 10: portal transition + meeting grid — the all-seated trigger end to end.
 *
 * Two players enter Room A and sit on different chairs. The moment the last
 * one sits, the server (the trigger state machine's only home) starts the
 * cancelable countdown and then the meeting: both clients portal into the
 * meeting grid (game scene asleep). One player clicks Leave: they portal out
 * alone — back in the world with the render loop awake — while the meeting
 * keeps running for the other.
 *
 * All waits are bus-hook or DOM conditions (zero sleeps). LiveKit tokens are
 * refused in both contexts (the suite's multi-context pattern — avoids the
 * two-context RTC reconnect storm): the grid renders its roster path — the
 * same tiles/nameplates/pixel-avatar fallbacks camera-off participants get —
 * which is exactly what PRD 10 specifies for camera-less identity.
 */
import { test, expect, type Page } from "@playwright/test";
import { enterRoom, knockAtDoor, respondToKnock, selfId, signUpAndJoin, sitAtSeat, uniqueUser } from "./helpers";

/** The client's current meeting hook state (mirrored server events). */
async function meetingState(
  page: Page,
): Promise<{ status: string; roomId: string } | null> {
  return page.evaluate(() => window.__testHook?.state.meeting ?? null);
}

async function waitForGrid(page: Page, visible: boolean): Promise<void> {
  await page.waitForFunction(
    (want) => (window.__testHook?.state.meetingGridVisible ?? false) === want,
    visible,
    { timeout: 30_000 },
  );
}

test("two players sit → countdown → meeting grid for both; one stands → back in world, other remains", async ({
  browser,
}) => {
  // Two live game contexts ≈ double the per-scenario work (same budget as
  // multiplayer/audio-isolation). Waits stay event-driven.
  test.setTimeout(120_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  for (const context of [contextA, contextB]) {
    await context.route("**/api/v1/livekit/token", (route) =>
      route.fulfill({ status: 403, json: { error: "e2e-media-disabled" } }),
    );
  }
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const userA = uniqueUser();
    const userB = uniqueUser();
    await signUpAndJoin(pageA, { map: "campus", user: userA });
    await signUpAndJoin(pageB, { map: "campus", user: userB });
    const idB = await selfId(pageB);
    await selfId(pageA);

    // A enters Room A and sits alone: today's behavior — no countdown, no grid.
    await enterRoom(pageA, "campus", "1");
    await sitAtSeat(pageA, "campus", "1");
    expect(await meetingState(pageA)).toBeNull();

    // B knocks; A (the room admin) approves. B's unseated entry over a solo
    // sitter still starts nothing; then B sits — now EVERY player in the room is
    // seated and count = 2: the countdown fires on both clients, meeting starts.
    await knockAtDoor(pageB, "campus", "1");
    await respondToKnock(pageA, "Approve");
    await pageB.waitForFunction(() => window.__testHook?.state.currentRoomId === "1");
    expect(await meetingState(pageA)).toBeNull();
    const countdownSeenByA = pageA.evaluate(() => {
      const hook = window.__testHook;
      if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
      return hook.waitForEvent("meeting-countdown");
    });
    await sitAtSeat(pageB, "campus", "1", { seat: 1 });
    const countdown = (await countdownSeenByA) as {
      roomId: string;
      durationMs: number;
      participants: { id: string }[];
    };
    expect(countdown.roomId).toBe("1");
    expect(countdown.participants).toHaveLength(2);

    // Portal + reveal on BOTH clients (Phase A slept the scene, Phase B
    // mounted the grid; the handoff emitted meeting-grid-visible).
    await waitForGrid(pageA, true);
    await waitForGrid(pageB, true);
    await expect(pageA.getByTestId("meeting-grid")).toBeVisible();
    await expect(pageB.getByTestId("meeting-grid")).toBeVisible();

    // Tiles carry game identity: one tile per participant, username
    // nameplates, pixel-sprite bodies (camera-off — media is refused here).
    for (const page of [pageA, pageB]) {
      await expect(page.getByTestId("meet-tile")).toHaveCount(2);
      await expect(page.getByTestId("meeting-grid")).toContainText(userA.username);
      await expect(page.getByTestId("meeting-grid")).toContainText(userB.username);
    }
    await expect(pageA.getByTestId("meet-tile-avatar")).toHaveCount(2);

    // B leaves via the meeting's Leave control (stand): a per-person portal
    // out. B lands back in the world with the game loop AWAKE; the meeting
    // continues for A alone.
    const leftSeenByA = pageA.evaluate(() => {
      const hook = window.__testHook;
      if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
      return hook.waitForEvent("meeting-participant-left");
    });
    await pageB.getByTitle("Leave meeting").click();

    await waitForGrid(pageB, false);
    await expect(pageB.getByTestId("meeting-grid")).toHaveCount(0);
    await pageB.waitForFunction(() => window.__testHook?.state.seated === null);
    // The woken render loop proves itself with a fresh positions tick.
    await pageB.evaluate(() => {
      const hook = window.__testHook;
      if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
      return hook.waitForEvent("positions");
    });

    // A saw B leave, still has the grid — now a solo tile.
    expect(((await leftSeenByA) as { playerId: string }).playerId).toBe(idB);
    await expect(pageA.getByTestId("meeting-grid")).toBeVisible();
    await expect(pageA.getByTestId("meet-tile")).toHaveCount(1);
    await expect(pageA.getByTestId("meeting-grid")).toContainText(userA.username);
    expect(await pageA.evaluate(() => window.__testHook?.state.meetingGridVisible)).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
