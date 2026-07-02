/**
 * User story 4: multiplayer presence — two browser contexts in the same
 * world see each other move and chat.
 */
import { test, expect } from "@playwright/test";
import { selfId, sendChat, signUpAndJoin, uniqueUser, walkTo } from "./helpers";

test("two players see each other move and chat", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const userA = uniqueUser();
    await signUpAndJoin(pageA, { map: "space", user: userA });
    await signUpAndJoin(pageB, { map: "space" });
    const idA = await selfId(pageA);

    // B sees A appear in its positions feed (other tests may be in the same
    // world, so assert on A's id specifically).
    await pageB.waitForFunction((id) => {
      const positions = window.__testHook?.state.last["positions"] as
        | { players: { id: string; self: boolean; x: number; y: number }[] }
        | undefined;
      return !!positions?.players.some((p) => !p.self && p.id === id);
    }, idA);
    const before = await pageB.evaluate((id) => {
      const positions = window.__testHook!.state.last["positions"] as {
        players: { id: string; x: number; y: number }[];
      };
      const player = positions.players.find((p) => p.id === id)!;
      return { x: player.x, y: player.y };
    }, idA);

    // A walks; B observes A's avatar displace by more than 24px.
    await walkTo(pageA, 500, 480);
    await pageB.waitForFunction(
      ({ id, x0, y0 }) => {
        const positions = window.__testHook?.state.last["positions"] as
          | { players: { id: string; x: number; y: number }[] }
          | undefined;
        const player = positions?.players.find((p) => p.id === id);
        return !!player && Math.hypot(player.x - x0, player.y - y0) > 24;
      },
      { id: idA, x0: before.x, y0: before.y },
    );

    // A chats to the world; B sees it in the transcript as "<name> text".
    const message = `ping from ${userA.username}`;
    await sendChat(pageA, message);
    await expect(
      pageB.locator(".mc-log .mc-line").filter({ hasText: message }),
    ).toBeVisible();
    await expect(
      pageB.locator(".mc-log .mc-line").filter({ hasText: message }),
    ).toContainText(`<${userA.username}>`);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
