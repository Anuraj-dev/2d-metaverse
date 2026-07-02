/**
 * Fails fast with actionable messages when the environment is not ready:
 * the composed backend must be up, and dist/ must be an E2E build (hook
 * compiled in, pointed at the backend).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://localhost:3001";
const DIST = join(import.meta.dirname, "..", "dist");

export default async function globalSetup(): Promise<void> {
  // 1. Backend stack reachable and ready (postgres + redis behind it).
  const ready = await fetch(`${BACKEND_URL}/health/ready`)
    .then((response) => response.ok)
    .catch(() => false);
  if (!ready) {
    throw new Error(
      `Backend not ready at ${BACKEND_URL}/health/ready.\n` +
        `Start the composed stack from the repo root first:\n` +
        `  docker compose up -d --build\n` +
        `(set CORS_ORIGINS=http://localhost:4173 so the preview origin is allowed)`,
    );
  }

  // 2. dist/ exists and contains the E2E hook (i.e. built with VITE_E2E_HOOK=1).
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(
      `No build found in frontend/dist. Build the E2E bundle first:\n` +
        `  VITE_E2E_HOOK=1 VITE_USE_MOCK=0 VITE_SERVER_URL=${BACKEND_URL} npm run build`,
    );
  }
  const assets = join(DIST, "assets");
  const hasHook = readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .some((f) => readFileSync(join(assets, f), "utf8").includes("__testHook"));
  if (!hasHook) {
    throw new Error(
      `frontend/dist was built WITHOUT the E2E hook (no __testHook in bundle).\n` +
        `Rebuild with:\n` +
        `  VITE_E2E_HOOK=1 VITE_USE_MOCK=0 VITE_SERVER_URL=${BACKEND_URL} npm run build`,
    );
  }
}
