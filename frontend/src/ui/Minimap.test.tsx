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
    vi.unstubAllGlobals();
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

  it("opens when chat runs the map command", () => {
    const { events, cleanupBus } = renderMap();
    try {
      events.length = 0;
      act(() => bus.emit("show-map"));
      expect(events).toEqual(["map-open"]);
    } finally {
      cleanupBus();
    }
  });

  it("reuses the static map across position ticks and rebuilds it for a new world", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    };
    // Only the canvas methods used by this surface are needed in jsdom.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const resizeWidth = vi.spyOn(HTMLCanvasElement.prototype, "width", "set");
    const resizeHeight = vi.spyOn(HTMLCanvasElement.prototype, "height", "set");
    render(<Minimap />);
    const world = { ...WORLD_INFO, rooms: [{ id: "1", x: 10, y: 10, w: 20, h: 20 }] };
    act(() => bus.emit("world-info", world));
    const initialWidthWrites = resizeWidth.mock.calls.length;
    const initialHeightWrites = resizeHeight.mock.calls.length;
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    for (let tick = 0; tick < 10; tick++) {
      act(() => bus.emit("positions", { players: [{ id: "me", self: true, x: tick, y: 5 }] }));
    }
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledTimes(10);
    expect(resizeWidth).toHaveBeenCalledTimes(initialWidthWrites);
    expect(resizeHeight).toHaveBeenCalledTimes(initialHeightWrites);
    expect(ctx.arc).toHaveBeenLastCalledWith(9, 5, expect.any(Number), 0, Math.PI * 2);
    act(() => bus.emit("world-info", { ...world, width: 200 }));
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    const canvas = screen.getByRole("button", { name: "Open campus map" }).querySelector("canvas");
    if (!canvas) throw new Error("Minimap canvas missing");
    const originalWidth = canvas.width;
    vi.stubGlobal("devicePixelRatio", 2);
    fireEvent(window, new Event("resize"));
    expect(canvas.width).toBe(originalWidth * 2);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(3);
    const transforms = ctx.setTransform.mock.calls;
    expect(transforms.at(-1)).toEqual(transforms.at(-3));
  });
});
