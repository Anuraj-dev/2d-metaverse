#!/usr/bin/env node
/**
 * Chrome-emoji guard (PRD 18). Emojis render differently on every OS, read as
 * unpolished next to the pixel art, and make icon-only buttons inaccessible —
 * so the UI chrome uses lucide SVG icons, never emoji. This script greps the
 * production frontend source for emoji codepoints and fails CI on any hit, so
 * "emojis everywhere" can never silently regress as agents add UI. Same spirit
 * as the prod-dist `__testHook` grep already in the frontend workflow.
 *
 * Scope: production source only — test files are excluded (a test may legitimately
 * assert on emoji content). User-typed chat content is never scanned; this guards
 * OUR source, not runtime user input.
 *
 * Match set: Unicode `Extended_Pictographic` (the canonical emoji property —
 * covers 🎙️ 📹 ⚙️ 🔔 👥 ✊ 🚪 ⚠️ 🕹️ 🌀 …), the emoji variation selector U+FE0F,
 * plus three icon-like symbols that are commonly reintroduced by hand but are
 * NOT Extended_Pictographic: ★ (U+2605), ⛶ (U+26F6), ✕ (U+2715). Typographic
 * marks deliberately kept in the UI — arrows (← → ↑), ● (U+25CF), › (U+203A) —
 * are intentionally NOT matched.
 *
 * Run:  node scripts/check-no-chrome-emoji.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FRONTEND, "src");

// Extra files outside src/ that ship to users and must also stay emoji-free.
const EXTRA_FILES = [join(FRONTEND, "index.html")];

const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".html"]);

/** A file is a test/spec (excluded) or lives under an e2e/ directory. */
const isExcluded = (path) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  /(^|\/)e2e\//.test(path.replace(/\\/g, "/"));

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{2605}\u{26F6}\u{2715}]/u;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [...walk(SRC), ...EXTRA_FILES].filter(
  (p) => SCAN_EXT.has(extname(p)) && !isExcluded(p)
);

const hits = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = EMOJI.exec(line);
    if (m) {
      const cp = m[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0");
      hits.push({ file: relative(FRONTEND, file), line: i + 1, char: m[0], cp });
    }
  });
}

if (hits.length > 0) {
  console.error(
    `✗ chrome-emoji guard: found ${hits.length} emoji in production frontend source.\n` +
      `  Replace UI-chrome emoji with a lucide icon (see PRD 18 / frontend README).`
  );
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.char}  (U+${h.cp})`);
  }
  process.exit(1);
}

console.log(`✓ no chrome emoji in ${files.length} production frontend source files`);
