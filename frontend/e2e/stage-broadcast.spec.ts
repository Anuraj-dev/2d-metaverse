/**
 * Stage broadcast (PRD 17). LiveKit scope per the media e2e boundary: fake media
 * devices; assert only "token fetched, connection attempted" + the bus/hook seam
 * (on-air lifecycle, audience subscription state) — never RTC internals. No sleeps:
 * every wait is a bus event or a hook-state condition.
 *
 * Waypoint path verified against campus.json with the avatar's REAL collision box
 * (18×14 body, offset per WorldScene `setSize(18,14).setOffset(7,16)` → x±9,
 * y..y+14), the walls layer AND the 54 solid-furniture footprints (each sized from
 * its texture PNG, 0.8w×0.55h bottom-anchored). The stage is walled with a single
 * 2-tile doorway in its south wall at x 1568–1600. Route: drop into the clear
 * corridor at y≈736 (16px below the stage's south wall so steering drift can't clip
 * the SW corner) → east under the wall → north straight through the doorway centre
 * (x=1584) into the interior. Every straight segment re-checked every 3px with the
 * full body box; standing point well inside the stage_zone rect.
 */
import { test, expect } from "@playwright/test";
import { BACKEND_URL, signUpAndJoin, enterRoom, walkPath } from "./helpers";

const STAGE_PATH: [number, number][] = [
  [960, 704],
  [1150, 736], // drop south into the corridor before the stage's west wall (x=1296)
  [1584, 736], // east under the south wall, aligned with the doorway centre
  [1584, 500], // north through the 2-tile doorway (x 1568–1600) into stage_zone
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
