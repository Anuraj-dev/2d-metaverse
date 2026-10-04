import { Component, type ReactNode } from "react";
import { reportCaughtError } from "../errorBeacon";
import { reloadPage } from "./reloadPage";

/** Lazy chunk and rendering failures must leave an actionable recovery screen. */
export default class RecoveryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    reportCaughtError(error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="login">
        <div className="login-card" role="alert">
          <h1>The space couldn’t load</h1>
          <p>Reload to try again. Your sign-in will be kept.</p>
          <button type="button" className="recovery-reload" onClick={reloadPage}>Reload space</button>
        </div>
      </main>
    );
  }
}
