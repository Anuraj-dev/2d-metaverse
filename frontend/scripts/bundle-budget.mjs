#!/usr/bin/env node
/**
 * Bundle budget guard. The initial (entry) JS chunk is what every visitor must
 * download before the login screen is interactive — Phaser and LiveKit are
 * lazy-loaded into separate chunks, so the entry must stay small. Fails CI if the
 * gzipped entry chunk exceeds the budget (e.g. if Phaser leaks back into it).
 *
 * Run after `npm run build`:  node scripts/bundle-budget.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const ASSETS = join(DIST, "assets");

// Budget for the entry chunk, gzipped. Current ~80 KB; headroom catches regressions
// like Phaser/LiveKit being pulled back into the initial download.
const ENTRY_BUDGET_KB = 120;

const html = readFileSync(join(DIST, "index.html"), "utf8");
const match = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/);
if (!match) {
  console.error("bundle-budget: could not find the entry chunk in dist/index.html");
  process.exit(1);
}
const entryFile = join(DIST, match[1].replace(/^\//, ""));

const gzipKb = (file) => gzipSync(readFileSync(file)).length / 1024;

console.log("JS chunks (gzipped):");
for (const f of readdirSync(ASSETS).filter((f) => f.endsWith(".js")).sort()) {
  const kb = gzipKb(join(ASSETS, f)).toFixed(1).padStart(7);
  const tag = join(ASSETS, f) === entryFile ? "  <- entry" : "";
  console.log(`  ${kb} KB  ${f}${tag}`);
}

const entryKb = gzipKb(entryFile);
console.log(
  `\nEntry chunk: ${entryKb.toFixed(1)} KB gzipped (budget ${ENTRY_BUDGET_KB} KB)`
);
if (entryKb > ENTRY_BUDGET_KB) {
  console.error(
    `✗ entry chunk exceeds budget by ${(entryKb - ENTRY_BUDGET_KB).toFixed(1)} KB`
  );
  process.exit(1);
}
console.log("✓ within budget");
