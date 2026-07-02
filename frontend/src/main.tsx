import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installErrorBeacon } from "./errorBeacon";
import { SERVER_URL, USE_MOCK } from "./net/config";

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

// StrictMode intentionally omitted: it double-mounts effects in dev, which would
// boot/destroy the Phaser game twice. Re-enable once mount is idempotent.
createRoot(document.getElementById("root")!).render(<App />);
