import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import HelpOverlay from "./HelpOverlay";

/**
 * The controls cheat-sheet must reflect the app's real keybindings and dock to
 * the chat panel's left column (not a centred modal).
 */
describe("HelpOverlay", () => {
  afterEach(cleanup);

  function open() {
    render(<HelpOverlay />);
    act(() => {
      fireEvent.keyDown(window, { key: "?" });
    });
  }

  it("lists the current keybindings, including the fullscreen map (M)", () => {
    open();
    // getByText throws if the row is missing.
    screen.getByText("Fullscreen map");
    screen.getByText("M (Esc to close)");
    // Interact (E) covers sit/stand/doors/tables/arcade.
    screen.getByText("Interact");
    screen.getByText("Chat");
    // The stale "Sit / Stand" row must be gone.
    expect(screen.queryByText("Sit / Stand")).toBeNull();
  });

  it("docks left-aligned via the help-backdrop modifier", () => {
    open();
    const card = screen.getByRole("heading", { name: "Controls" });
    const backdrop = card.closest(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    expect(backdrop?.classList.contains("help-backdrop")).toBe(true);
  });
});
