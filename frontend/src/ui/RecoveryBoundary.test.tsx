import { lazy, Suspense } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecoveryBoundary from "./RecoveryBoundary";
import { reportCaughtError } from "../errorBeacon";
import { reloadPage } from "./reloadPage";

vi.mock("../errorBeacon", () => ({ reportCaughtError: vi.fn() }));
vi.mock("./reloadPage", () => ({ reloadPage: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.removeItem("token");
});

describe("RecoveryBoundary", () => {
  it("renders healthy content", () => {
    render(<RecoveryBoundary><p>Ready</p></RecoveryBoundary>);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers a failed lazy chunk with an explicit reload and preserves sign-in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("token", "session-token");
    const error = new Error("Failed to fetch dynamically imported module: private diagnostics");
    const Broken = lazy(() => Promise.reject(error));
    render(
      <RecoveryBoundary>
        <Suspense fallback={<p>Loading</p>}><Broken /></Suspense>
      </RecoveryBoundary>,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(reportCaughtError).toHaveBeenCalledWith(error);
    expect(screen.queryByText(/private diagnostics/)).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload space" }));
    expect(reloadPage).toHaveBeenCalledOnce();
    expect(localStorage.getItem("token")).toBe("session-token");
  });
});
