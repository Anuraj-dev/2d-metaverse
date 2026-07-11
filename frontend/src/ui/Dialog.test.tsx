import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import Dialog from "./Dialog";

afterEach(cleanup);

describe("Dialog primitive (a11y seam)", () => {
  it("exposes a named modal dialog with a label", () => {
    render(
      <Dialog onClose={() => {}} label="Controls">
        <button>Got it</button>
      </Dialog>
    );
    const dlg = screen.getByRole("dialog", { name: "Controls" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
  });

  it("supports aria-labelledby over a plain label", () => {
    render(
      <Dialog onClose={() => {}} labelledBy="t">
        <h3 id="t">Titled</h3>
      </Dialog>
    );
    const dlg = screen.getByRole("dialog", { name: "Titled" });
    expect(dlg.getAttribute("aria-labelledby")).toBe("t");
    expect(dlg.getAttribute("aria-label")).toBeNull();
  });

  it("moves initial focus to the first focusable control", () => {
    render(
      <Dialog onClose={() => {}} label="D">
        <button>first</button>
        <button>second</button>
      </Dialog>
    );
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} label="D">
        <button>x</button>
      </Dialog>
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but not on a panel click", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} label="D" backdropClassName="bg" className="panel">
        <button>x</button>
      </Dialog>
    );
    fireEvent.click(screen.getByText("x"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".bg") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("contains and wraps Tab focus within the panel", () => {
    render(
      <Dialog onClose={() => {}} label="D">
        <button>a</button>
        <button>b</button>
      </Dialog>
    );
    const a = screen.getByText("a");
    const b = screen.getByText("b");
    expect(document.activeElement).toBe(a);
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(document.activeElement).toBe(b);
    // Tab off the last control wraps to the first.
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(document.activeElement).toBe(a);
    // Shift+Tab from the first wraps to the last.
    act(() => {
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    });
    expect(document.activeElement).toBe(b);
  });

  it("restores focus to the opener when it unmounts", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && (
            <Dialog onClose={() => setOpen(false)} label="D">
              <button>close</button>
            </Dialog>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText("opener");
    act(() => {
      opener.focus();
      fireEvent.click(opener);
    });
    expect(document.activeElement).toBe(screen.getByText("close"));
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(document.activeElement).toBe(opener);
  });

  it("only the topmost of nested dialogs handles Escape", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog onClose={outer} label="outer">
          <button>o</button>
        </Dialog>
        <Dialog onClose={inner} label="inner">
          <button>i</button>
        </Dialog>
      </>
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("inerts background siblings but exempts keep-live regions, which stay in the focus ring", () => {
    render(
      <div>
        <Dialog onClose={() => {}} label="D" backdropClassName="bg">
          <button>close</button>
        </Dialog>
        <div data-testid="bgworld">
          <button>world</button>
        </div>
        <div data-dialog-keep-live data-testid="live">
          <button>approve</button>
        </div>
      </div>
    );
    const world = screen.getByTestId("bgworld");
    const live = screen.getByTestId("live");
    expect(world.getAttribute("inert")).toBe("");
    expect(world.getAttribute("aria-hidden")).toBe("true");
    // The urgent-HUD exemption: the keep-live region is never inerted.
    expect(live.hasAttribute("inert")).toBe(false);
    expect(live.getAttribute("aria-hidden")).toBeNull();
    // …and its control is woven into the trap ring: Tab off the panel's last
    // control lands on the keep-live control rather than wrapping straight back.
    expect(document.activeElement).toBe(screen.getByText("close"));
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(document.activeElement).toBe(screen.getByText("approve"));
  });

  it("clears background inertness on close", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <div>
          {open && (
            <Dialog onClose={() => setOpen(false)} label="D">
              <button>close</button>
            </Dialog>
          )}
          <div data-testid="bgworld">
            <button>world</button>
          </div>
        </div>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("bgworld").getAttribute("inert")).toBe("");
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByTestId("bgworld").hasAttribute("inert")).toBe(false);
  });
});
