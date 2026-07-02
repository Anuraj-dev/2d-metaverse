import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite: drives the BUILT frontend (vite preview, port 4173) against the
 * docker-composed backend stack (backend on 3001). See README "E2E tests".
 *
 * Build the frontend with the test hook before running:
 *   VITE_E2E_HOOK=1 VITE_SERVER_URL=http://localhost:3001 npm run build
 *
 * Flake policy: no arbitrary sleeps — every wait is a bus-event or DOM
 * condition. CI retries: 1 (failures still reported); local retries: 0 so
 * flaky waits surface immediately and get fixed, not retried away.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // All scenarios share one live world (space "1" on the composed backend), so
  // they run serially — parallel workers see each other's avatars and can
  // interfere. Serial full-suite runtime is ~2-3 min, within the CI budget.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Fake media devices: LiveKit assertions stop at "token fetched,
        // connection attempted" — media quality is out of scope.
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
        permissions: ["camera", "microphone"],
      },
    },
  ],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
