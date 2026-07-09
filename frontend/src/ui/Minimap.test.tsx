import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import Minimap from "./Minimap";
import { bus } from "../game/eventBus";

// The lazy fullscreen map pulls a canvas-heavy child; stub it so the test
// observes open/close through the bus events, not the rendered map internals.
vi.mock("./FullscreenMap", () => ({
  default: () => <div data-testid="fullscreen-map" />,
}));

const WORLD_INFO = { width: 100, height: 100, rooms: [], areas: [], terrain: null };

/**
 * The fullscreen campus map and the Settings panel are mutually-exclusive HUD
 * overlays (issue #79): opening one closes the other. The map captures/hands
 * back movement via `map-open`/`map-close`, so those events track its state.
 */
describe("Minimap overlay exclusivity", () => {
  beforeEach(() => {
    // jsdom has no 2D context; the draw effect guards a null context.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderMap() {
    const events: string[] = [];
    const offOpen = bus.on("map-open", () => events.push("map-open"));
    const offClose = bus.on("map-close", () => events.push("map-close"));
    render(<Minimap />);
    act(() => {
      bus.emit("world-info", WORLD_INFO);
    });
    return { events, cleanupBus: () => (offOpen(), offClose()) };
  }

  it("closes the map when Settings opens", () => {
    const { events, cleanupBus } = renderMap();
    try {
      // Mount emits an initial map-close (open === false); ignore it.
      events.length = 0;

      // Open the map (its `map-open`/`map-close` events mirror the open state;
      // the fullscreen surface itself is lazy so it isn't in the DOM yet).
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Open campus map" }));
      });
      expect(events).toEqual(["map-open"]);

      // Settings opening must close the map (emitting map-close).
      act(() => {
        bus.emit("settings-open");
      });
      expect(events).toEqual(["map-open", "map-close"]);
    } finally {
      cleanupBus();
    }
  });
});
