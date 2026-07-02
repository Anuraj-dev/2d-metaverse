/**
 * LiveKit scope per PRD: fake media devices via chromium flags; assert only
 * "token fetched, connection attempted" — media quality is out of scope.
 * Joining the world triggers the world-audio join automatically.
 */
import { test, expect } from "@playwright/test";
import { BACKEND_URL, signUpAndJoin } from "./helpers";

test("livekit token fetched and connection attempted on world join", async ({ page }) => {
  const tokenResponse = page.waitForResponse(
    (response) =>
      response.url() === `${BACKEND_URL}/api/v1/livekit/token` &&
      response.request().method() === "POST",
    { timeout: 30_000 },
  );
  const wsAttempt = page.waitForEvent("websocket", {
    predicate: (ws) => ws.url().includes(":7880"),
    timeout: 30_000,
  });

  await signUpAndJoin(page, { map: "space" });

  // Token fetched...
  const response = await tokenResponse;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { livekitToken: string; url: string };
  expect(body.livekitToken.length).toBeGreaterThan(0);

  // ...and a LiveKit websocket connection was attempted.
  await wsAttempt;
});
