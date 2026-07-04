/**
 * Stage broadcast (PRD 17). LiveKit scope per the media e2e boundary: fake media
 * devices; assert only "token fetched, connection attempted" + the bus/hook seam
 * (on-air lifecycle, audience subscription state) — never RTC internals. No sleeps:
 * every wait is a bus event or a hook-state condition.
 *
 * Waypoint path verified wall-free against campus.json (walls layer + solid
 * furniture): spawn → east along the plaza corridor (a wall band blocks the direct
 * diagonal) → north into the stage interior, standing at the stage centre.
 */
import { test, expect } from "@playwright/test";
import { BACKEND_URL, signUpAndJoin, enterRoom, walkPath } from "./helpers";

const STAGE_PATH: [number, number][] = [
  [960, 704],
  [1288, 720],
  [1576, 720],
  [1600, 480], // stage_zone centre (rect 1312,256 + 576×448), confirmed walkable
];

test("a performer standing still on the stage goes on air with a publish token", async ({
  page,
}) => {
  // The publish token request carries stagePublish:true; the audience token on
  // join does not, so this predicate matches only the on-air request.
  const publishToken = page.waitForResponse(
    (response) =>
      response.url() === `${BACKEND_URL}/api/v1/livekit/token` &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { stagePublish?: boolean } | null)?.stagePublish ===
        true,
    { timeout: 30_000 },
  );

  await signUpAndJoin(page, { map: "campus" });
  await walkPath(page, STAGE_PATH);

  // Standing still on the stage arms the confirm prompt (~2s) — an event, not a sleep.
  await page.evaluate(() => window.__testHook?.waitForEvent("stage-prompt-show", undefined, 15_000));

  // Confirm through the same bus seam the HUD "Go on air" button drives, and wait
  // for the on-air transition.
  const onAir = page.evaluate(() =>
    window.__testHook?.waitForEvent("stage-on-air", undefined, 15_000),
  );
  await page.evaluate(() => window.__testHook?.emit("stage-confirm"));
  await onAir;

  // A publish-capable token was requested and the server (validating the on-stage
  // position it knows) granted it.
  const response = await publishToken;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { livekitToken: string };
  expect(body.livekitToken.length).toBeGreaterThan(0);
});

test("stage audience subscribes on join and detaches inside a private room", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });

  // Every non-private-room client subscribes to the stage as audience on join.
  await page.waitForFunction(
    () =>
      (window.__testHook?.state.last["stage-audience"] as { active: boolean } | undefined)
        ?.active === true,
    undefined,
    { timeout: 15_000 },
  );

  // Entering a private room detaches the stage subscription entirely (no stage
  // audio inside a meeting).
  await enterRoom(page, "campus", "1");
  await page.waitForFunction(
    () =>
      (window.__testHook?.state.last["stage-audience"] as { active: boolean } | undefined)
        ?.active === false,
    undefined,
    { timeout: 15_000 },
  );
});
