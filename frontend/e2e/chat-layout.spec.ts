import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

// CSS geometry regression: jsdom cannot detect flex rows shrinking and overlap.
// No backend traffic is needed; use the shipped stylesheet and transcript DOM.
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const message = "A long room message ".repeat(20) + "x".repeat(200);

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 640, height: 360 }]) {
  test(`chat rows stay separated at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const rows = Array.from({ length: 20 }, (_, i) =>
      `<p class="meeting-chat-line"><span class="meeting-chat-name">Player ${i}</span><span class="meeting-chat-text">${message}</span></p>`,
    ).join("");
    await page.setContent(`<style>${css}</style><div class="meeting-stage"><header class="meeting-topbar">Meeting</header><div class="meeting-body"><div class="meet-grid"></div><section class="meeting-chat"><header class="meeting-chat-head">Chat</header><div class="meeting-chat-list">${rows}</div><button class="meeting-chat-latest">New messages · Jump to latest</button><form class="meeting-chat-input"><input><button>Send</button></form></section></div></div>`);
    const meeting = await page.locator(".meeting-chat-list").evaluate((list) => {
      const bounds = [...list.children].map((row) => row.getBoundingClientRect());
      return {
        overlap: bounds.some((row, i) => { const previous = bounds[i - 1]; return previous !== undefined && row.top < previous.bottom - 0.5; }),
        verticalScroll: list.scrollHeight > list.clientHeight,
        horizontalScroll: list.scrollWidth > list.clientWidth,
        height: list.clientHeight,
      };
    });
    expect(meeting).toMatchObject({ overlap: false, verticalScroll: true, horizontalScroll: false });
    expect(meeting.height).toBeGreaterThan(0);
    const composer = await page.locator(".meeting-chat-input").boundingBox();
    const panel = await page.locator(".meeting-chat").boundingBox();
    if (!composer || !panel) throw new Error("Chat panel and composer must be visible");
    expect(composer.y + composer.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    expect(composer.y).toBeGreaterThanOrEqual(panel.y);

    const worldRows = Array.from({ length: 20 }, () => `<div class="mc-line"><span class="mc-name">Player</span> <span class="mc-text">${message}</span></div>`).join("");
    await page.setContent(`<style>${css}</style><div class="mc-chat"><div class="mc-tabs">Chat</div><div class="mc-list">${worldRows}</div><form class="mc-input"><input></form></div>`);
    const world = await page.locator(".mc-list").evaluate((list) => {
      const bounds = [...list.children].map((row) => row.getBoundingClientRect());
      return {
        overlap: bounds.some((row, i) => { const previous = bounds[i - 1]; return previous !== undefined && row.top < previous.bottom - 0.5; }),
        verticalScroll: list.scrollHeight > list.clientHeight,
        horizontalScroll: list.scrollWidth > list.clientWidth,
      };
    });
    expect(world).toEqual({ overlap: false, verticalScroll: true, horizontalScroll: false });
  });
}
