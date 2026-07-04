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

// Budget for the entry chunk, gzipped. The real (configured-production) entry
// is ~120.5 KB — earlier CI measured ~105 KB only because the build lacked
// VITE_SERVER_URL and Vite tree-shook the app behind the misconfiguration
// screen. The budget still catches real regressions like Phaser/LiveKit leaking
// into the entry.
//
// Raised 125 → 130 for PRD 16 (arcade zone): the entry had reached the old
// 125 KB ceiling exactly (zero headroom on CI), and this feature adds a small,
// unavoidable core-mixer bit — the `arcade` sound channel in soundMixer +
// two settings fields, both consumed by the always-loaded SfxBridge. The arcade
// overlay, game renderers and PRNG stay lazy-loaded in their own chunk (~5 KB,
// out of the entry). 130 KB restores a few KB of headroom without letting the
// heavy transitive deps back in.
const ENTRY_BUDGET_KB = 130;

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
