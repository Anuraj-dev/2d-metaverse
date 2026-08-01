/**
 * Stage broadcast (PRD 17). LiveKit scope per the media e2e boundary: fake media
 * devices; assert only "token fetched, connection attempted" + the bus/hook seam
 * (audience subscription state, on-air lifecycle) — never RTC internals. No sleeps:
 * every wait is a bus event or a hook-state condition.
 *
 * One consolidated scenario (a single fresh signup) to stay well within the suite's
 * per-IP auth-limiter budget. It covers the two unique PRD 17 mechanics end to end:
 *  1. every non-private-room client subscribes to the stage room as audience on join
 *     (server-wide, not proximity-gated);
 *  2. a performer who stands still on the presenter platform is granted a
 *     position-validated publish token and goes on air (audience floor alone
 *     is not enough — publish is presenter-only).
 * The private-room detach exception (room-av mode → stage subscription removed) is
 * asserted at the unit level in `src/App.test.tsx` ("entering a private room …
 * detaches room + stage video"), so it is not re-walked here.
 *
 * Waypoint path verified against campus.json with the avatar's REAL collision box
 * (18×14 body, offset per WorldScene `setSize(18,14).setOffset(7,16)` → x±9,
 * y..y+14), the walls layer AND the 54 solid-furniture footprints (each sized from
 * its texture PNG, 0.8w×0.55h bottom-anchored). The stage is walled with a single
 * 2-tile doorway in its south wall at x 1568–1600. Route: drop into the clear
 * corridor at y≈736 (16px below the stage's south wall so steering drift can't clip
 * the SW corner) → east under the wall → north straight through the doorway centre
 * (x=1584) into the interior. Every straight segment re-checked every 3px with the
 * full body box; standing point on the presenter_zone (not merely stage_zone).
 */
import { test, expect } from "@playwright/test";
import { BACKEND_URL, signUpAndJoin, walkPath } from "./helpers";

const STAGE_PATH: [number, number][] = [
  [960, 704],
  [1150, 736], // drop south into the corridor before the stage's west wall (x=1296)
  [1584, 736], // east under the south wall, aligned with the doorway centre
  [1584, 500], // north through the 2-tile doorway (x 1568–1600) into stage_zone
  // Presenter platform (presenter_zone 1440,32 + 336×224) — only here arms Go Live.
  [1584, 200],
  [1608, 144], // platform centre
];

test("audience subscribes on join, then standing still on the stage goes on air", async ({
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

  // (1) Every non-private-room client subscribes to the stage as audience on join.
  await page.waitForFunction(
    () =>
      (window.__testHook?.state.last["stage-audience"] as { active: boolean } | undefined)
        ?.active === true,
    undefined,
    { timeout: 15_000 },
  );

  // (2) Walk onto the presenter platform and hold position — the ~2s stillness
  // arms the prompt (audience floor never does).
  await walkPath(page, STAGE_PATH);
  await page.evaluate(() => window.__testHook?.waitForEvent("stage-prompt-show", undefined, 15_000));

  // Confirm through the same bus seam the HUD "Go Live" button drives.
  const onAir = page.evaluate(() =>
    window.__testHook?.waitForEvent("stage-on-air", undefined, 15_000),
  );
  await page.evaluate(() => window.__testHook?.emit("stage-confirm"));
  await onAir;

  // A publish-capable token was requested and the server (validating the on-
  // presenter-platform position it knows) granted it.
  const response = await publishToken;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { livekitToken: string };
  expect(body.livekitToken.length).toBeGreaterThan(0);
});
