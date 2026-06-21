import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// StrictMode intentionally omitted: it double-mounts effects in dev, which would
// boot/destroy the Phaser game twice. Re-enable once mount is idempotent.
createRoot(document.getElementById("root")!).render(<App />);
