import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import Settings from "./Settings";
import { bus } from "../game/eventBus";

/**
 * The Settings panel and the fullscreen campus map are mutually-exclusive HUD
 * overlays (issue #79): they must never stack. Settings closes when the map
 * opens, and announces its own open so the map can close in turn.
 */
describe("Settings overlay exclusivity", () => {
  afterEach(cleanup);

  function openPanel() {
    render(<Settings />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
  }

  it("closes the panel when the fullscreen map opens", () => {
    openPanel();
    // Panel is open (heading present).
    screen.getByRole("heading", { name: "Settings" });

    act(() => {
      bus.emit("map-open");
    });

    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });

  it("announces settings-open on the open transition (so the map can close)", () => {
    const opens: number[] = [];
    const off = bus.on("settings-open", () => opens.push(1));
    try {
      openPanel();
      // Exactly one announcement on open…
      expect(opens).toHaveLength(1);

      // …and closing again does not re-announce (no ping-pong).
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      });
      expect(opens).toHaveLength(1);
    } finally {
      off();
    }
  });
});
