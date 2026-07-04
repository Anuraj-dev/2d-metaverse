/**
 * PRD 9: zone-aware proximity audio — no voice through walls.
 *
 * Two players outdoors hear each other (proximity audio); the moment one steps
 * inside a meeting room, the outside player's world-audio volume for them drops
 * to zero — even though they are still well within the distance cutoff. This
 * proves the cutoff is caused by the ZONE boundary, not by distance.
 *
 * The world-audio volume the media layer computes for each remote is surfaced
 * on the `audio-volumes` bus event (E2E build only). Reading that, rather than a
 * live `<audio>` element's `.volume`, keeps the scenario deterministic: the
 * decision is derived purely from broadcast positions + map zones, so no live
 * LiveKit RTC subscription (a two-context RTC storm) is needed. The LiveKit
 * token is refused in both contexts exactly as multiplayer.spec.ts does.
 */
import { test, expect, type Page } from "@playwright/test";
import { enterRoom, selfId, signUpAndJoin, uniqueUser, walkPath, walkTo } from "./helpers";

/** The world-audio volume `observer` currently assigns to `playerId` (or null). */
async function volumeFor(observer: Page, playerId: string): Promise<number | null> {
  return observer.evaluate((id) => {
    const last = window.__testHook?.state.last["audio-volumes"] as
      | { volumes: Record<string, number> }
      | undefined;
    const v = last?.volumes[id];
    return typeof v === "number" ? v : null;
  }, playerId);
}

/**
 * Wait until `observer`'s world-audio volume for `playerId` is either strictly
 * positive (`"audible"`) or exactly zero (`"silent"`). Purely event-driven —
 * polls the latest `audio-volumes` payload the hook mirrors.
 */
async function waitForVolume(
  observer: Page,
  playerId: string,
  want: "audible" | "silent",
): Promise<void> {
  await observer.waitForFunction(
    ({ id, want }) => {
      const last = window.__testHook?.state.last["audio-volumes"] as
        | { volumes: Record<string, number> }
        | undefined;
      const v = last?.volumes[id];
      if (typeof v !== "number") return false;
      return want === "audible" ? v > 0 : v === 0;
    },
    { id: playerId, want },
    { timeout: 30_000 },
  );
}

test("a player entering a room goes silent to those outside it", async ({ browser }) => {
  // Two live game contexts is roughly double the per-scenario work; match the
  // multiplayer budget. The waits themselves stay event-driven (no sleeps).
  test.setTimeout(120_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  // Refuse the LiveKit token in both contexts: worldAudio.start() catches the
  // failed fetch but still prices volumes off the positions feed, so the
  // `audio-volumes` decision is observable without a real RTC subscription (and
  // without the two-context reconnect storm that starves the frame loops).
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
    await selfId(pageA); // ensure A's socket init completed before asserting

    // Both walk down to the hostel forecourt and stand outdoors, ~84px apart in
    // the same (outdoor) zone — well within the 200px cutoff. A stands off to
    // the east (x=784) so it never blocks B's descent down the x=560 path.
    await walkPath(pageA, [[560, 704], [560, 1520], [784, 1520]]);
    await walkPath(pageB, [[560, 704], [560, 1520], [700, 1520]]);

    // A hears B: same zone + close ⇒ non-zero world-audio volume.
    await waitForVolume(pageA, idB, "audible");

    // B enters hostel Room 1 (north door) and steps a little deeper inside. B is
    // now in a different audio zone than A, but still only ~126px away — inside
    // the cutoff.
    await enterRoom(pageB, "campus", "1");
    await walkTo(pageB, 736, 1636);

    // Zone isolation: A's volume for B is exactly zero despite the short
    // distance — the wall, not the falloff, silenced them.
    await waitForVolume(pageA, idB, "silent");
    expect(await volumeFor(pageA, idB)).toBe(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
