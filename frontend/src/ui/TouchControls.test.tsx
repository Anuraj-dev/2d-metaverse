import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import TouchControls from "./TouchControls";
import { bus } from "../game/eventBus";

let matches = false;
let change: (() => void) | undefined;
beforeEach(() => {
  matches = false;
  change = undefined;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return matches; },
    addEventListener: (_type: string, listener: () => void) => { change = listener; },
    removeEventListener: vi.fn(),
  })));
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  });
  vi.stubGlobal("ontouchstart", null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function rotate(landscape: boolean) {
  act(() => { matches = landscape; change?.(); });
}
function drag() {
  const joystick = screen.getByRole("group", { name: "Movement joystick" });
  Object.defineProperty(joystick, "setPointerCapture", { value: vi.fn() });
  fireEvent.pointerDown(joystick, { pointerId: 1, clientX: 46, clientY: 0 });
  return joystick;
}

describe("touch movement lifecycle", () => {
  it("appears after rotating to landscape without another React render", () => {
    render(<TouchControls />);
    expect(screen.queryByRole("button", { name: "Interact" })).toBeNull();
    rotate(true);
    expect(screen.getByRole("button", { name: "Interact" })).toBeTruthy();
    rotate(false);
    expect(screen.queryByRole("button", { name: "Interact" })).toBeNull();
  });

  it.each(["blur", "capture", "rotation", "unmount"])("releases held movement on %s", (reason) => {
    matches = true;
    const emit = vi.spyOn(bus, "emit");
    const { unmount } = render(<TouchControls />);
    const joystick = drag();
    expect(emit).toHaveBeenLastCalledWith("move-axis", { x: 1, y: 0 });
    if (reason === "blur") fireEvent.blur(window);
    if (reason === "capture") fireEvent.lostPointerCapture(joystick, { pointerId: 1 });
    if (reason === "rotation") rotate(false);
    if (reason === "unmount") unmount();
    expect(emit).toHaveBeenLastCalledWith("move-axis", { x: 0, y: 0 });
  });

  it("ignores a second finger until the original pointer releases", () => {
    matches = true;
    const emit = vi.spyOn(bus, "emit");
    render(<TouchControls />);
    const joystick = drag();
    emit.mockClear();
    fireEvent.pointerDown(joystick, { pointerId: 2, clientX: -46 });
    fireEvent.pointerUp(joystick, { pointerId: 2 });
    expect(emit).not.toHaveBeenCalled();
    fireEvent.pointerUp(joystick, { pointerId: 1 });
    expect(emit).toHaveBeenLastCalledWith("move-axis", { x: 0, y: 0 });
  });

  it("supports standard button activation for the action control", () => {
    matches = true;
    const emit = vi.spyOn(bus, "emit");
    render(<TouchControls />);
    fireEvent.click(screen.getByRole("button", { name: "Interact" }));
    expect(emit).toHaveBeenCalledWith("do-interact");
  });
});
