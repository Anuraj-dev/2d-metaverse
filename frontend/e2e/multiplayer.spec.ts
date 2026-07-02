/**
 * User story 4: multiplayer presence — two browser contexts in the same
 * world see each other move and chat, in BOTH directions (each context is
 * exercised as a receiver, not just a sender).
 */
import { test, expect, type Page } from "@playwright/test";
import { selfId, sendChat, signUpAndJoin, uniqueUser, walkTo } from "./helpers";

/** Wait until `observer` has `playerId` in its positions feed, return its position. */
async function observePeer(
  observer: Page,
  playerId: string,
): Promise<{ x: number; y: number }> {
  await observer.waitForFunction((id) => {
    const positions = window.__testHook?.state.last["positions"] as
      | { players: { id: string; self: boolean }[] }
      | undefined;
    return !!positions?.players.some((p) => !p.self && p.id === id);
  }, playerId);
  return observer.evaluate((id) => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    const positions = hook.state.last["positions"] as {
      players: { id: string; x: number; y: number }[];
    };
    const player = positions.players.find((p) => p.id === id)!;
    return { x: player.x, y: player.y };
  }, playerId);
}

/** Assert `observer` sees `playerId` displace >24px from `from`. */
async function expectPeerMoved(
  observer: Page,
  playerId: string,
  from: { x: number; y: number },
): Promise<void> {
  await observer.waitForFunction(
    ({ id, x0, y0 }) => {
      const positions = window.__testHook?.state.last["positions"] as
        | { players: { id: string; x: number; y: number }[] }
        | undefined;
      const player = positions?.players.find((p) => p.id === id);
      return !!player && Math.hypot(player.x - x0, player.y - y0) > 24;
    },
    { id: playerId, x0: from.x, y0: from.y },
  );
}

/** Assert `observer` renders `<sender> message` in the chat transcript. */
async function expectChatSeen(
  observer: Page,
  sender: string,
  message: string,
): Promise<void> {
  const line = observer.locator(".mc-log .mc-line").filter({ hasText: message });
  await expect(line).toBeVisible();
  await expect(line).toContainText(`<${sender}>`);
}

test("two players see each other move and chat (both directions)", async ({ browser }) => {
  // Two live game contexts on one CI runner is roughly double the work of
  // every other scenario, so this test gets a proportionate budget (the waits
  // themselves stay event-driven).
  test.setTimeout(120_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  // Media is out of scope here (livekit.spec.ts owns it). Refuse the LiveKit
  // token in both contexts: worldAudio.start() catches the failed fetch and
  // gives up cleanly, which spares the CI runner the livekit-client reconnect
  // storm (two contexts retrying RTC against the dev server starves the
  // Phaser frame loops and blows the test budget).
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
    await signUpAndJoin(pageA, { map: "space", user: userA });
    await signUpAndJoin(pageB, { map: "space", user: userB });
    const idA = await selfId(pageA);
    const idB = await selfId(pageB);

    // Other tests may share the world, so all assertions target ids A/B.
    // A -> B: B observes A move, then A's chat line.
    const aSeenByB = await observePeer(pageB, idA);
    await walkTo(pageA, 500, 480);
    await expectPeerMoved(pageB, idA, aSeenByB);
    const messageA = `ping from ${userA.username}`;
    await sendChat(pageA, messageA);
    await expectChatSeen(pageB, userA.username, messageA);

    // B -> A: the reciprocal direction, A as the receiver.
    const bSeenByA = await observePeer(pageA, idB);
    await walkTo(pageB, 300, 420);
    await expectPeerMoved(pageA, idB, bSeenByA);
    const messageB = `pong from ${userB.username}`;
    await sendChat(pageB, messageB);
    await expectChatSeen(pageA, userB.username, messageB);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
