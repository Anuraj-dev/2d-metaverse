import { test, expect } from "@playwright/test";
import { signUpAndJoin } from "./helpers";

test("a saved session can resume, or switch back to password sign-in", async ({ page }) => {
  const user = await signUpAndJoin(page);
  await page.reload();
  await page.getByRole("button", { name: `Continue as ${user.username}`, exact: true }).click();
  await expect(page.locator(".presence")).toHaveText("connected");

  await page.reload();
  await page.getByRole("button", { name: "Use another account", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.locator(".console-submit").click();
  await expect(page.locator(".presence")).toHaveText("connected");
});

test("invalid credentials stay on the form with an actionable error", async ({ page }) => {
  await page.goto("/");
  await page.locator(".console-submit").click();
  await expect(page.getByText("Username is required.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeFocused();
  await page.getByLabel("Username", { exact: true }).fill(`missing_${Date.now()}`);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password-123");
  await page.locator(".console-submit").click();
  await expect(page.getByRole("alert")).toContainText("Check your username and password");
  await expect(page.locator(".console-submit")).toBeEnabled();
});
