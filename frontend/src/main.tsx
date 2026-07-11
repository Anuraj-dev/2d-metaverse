import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installErrorBeacon } from "./errorBeacon";
import { SERVER_URL, USE_MOCK } from "./net/config";
import { initReducedMotion } from "./ui/reducedMotionBridge";

// PRD 25.19: resolve the global reduced-motion preference and stamp the root
// `data-reduced-motion` attribute before first paint, so CSS overrides apply
// without a flash and Phaser/Motion read a settled value.
initReducedMotion();

// Ship uncaught errors to the backend log stream — real backend mode only
// (mock mode has no server to receive them). Never blocks or breaks the app.
if (!USE_MOCK && SERVER_URL) {
  installErrorBeacon({ endpoint: `${SERVER_URL}/client-errors`, sha: __APP_SHA__ });
}

// E2E-only test hook (window.__testHook): the Playwright suite asserts through
// the event-bus seam instead of reading canvas pixels. `VITE_E2E_HOOK` is
// statically replaced at build time, so in production builds this branch is
// dead code and the hook module is tree-shaken out of the bundle entirely.
if (import.meta.env.VITE_E2E_HOOK === "1") {
  void import("./e2e/testHook").then(({ installTestHook }) => installTestHook());
}

// The #root element is hard-coded in index.html; if it's missing the page is
// fundamentally broken, so fail loudly with a descriptive bootstrap error.
const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Bootstrap failed: #root element not found in index.html');
}

// StrictMode intentionally omitted: it double-mounts effects in dev, which would
// boot/destroy the Phaser game twice. Re-enable once mount is idempotent.
createRoot(rootEl).render(<App />);
