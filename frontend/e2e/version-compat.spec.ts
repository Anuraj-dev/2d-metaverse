/**
 * User story 6: deployment drift is machine-detectable — the frontend's
 * built git SHA (test hook + Settings HUD) must match the backend's
 * /health/ready SHA. A stale frontend bundle makes this red.
 */
import { test, expect } from "@playwright/test";
import { backendSha, signUpAndJoin } from "./helpers";

test("frontend build SHA matches backend /health/ready SHA", async ({ page }) => {
  await signUpAndJoin(page, { map: "campus" });

  const frontendSha = await page.evaluate(() => {
    const hook = window.__testHook;
    if (!hook) throw new Error("E2E test hook missing on window (build with VITE_E2E_HOOK=1)");
    return hook.sha;
  });
  const serverSha = await backendSha(page);

  expect(frontendSha, "frontend must be stamped (VITE_GIT_SHA)").not.toBe("");
  expect(
    frontendSha,
    `version drift: frontend built at ${frontendSha}, backend running ${serverSha}`,
  ).toBe(serverSha);

  // The same SHA is what operators see in the Settings HUD.
  await page.getByTitle("Settings").click();
  await expect(page.locator(".set-version")).toHaveText(
    `build ${frontendSha.slice(0, 7)}`,
  );
});
