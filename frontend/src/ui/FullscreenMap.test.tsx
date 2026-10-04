import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";
import FullscreenMap, { type FullMapInfo, type MapDotFull } from "./FullscreenMap";

const info: FullMapInfo = {
  width: 200,
  height: 100,
  rooms: [{ id: "1", x: 10, y: 10, w: 20, h: 20 }],
  areas: [{ id: "mandakini", x: 0, y: 0, w: 60, h: 60 }],
  terrain: null,
};

// jsdom's getBoundingClientRect is all-zeros, so a canvas click maps to world (0,0);
// place a dot there so the locate hit-test resolves.
const dots: MapDotFull[] = [
  { id: "me", self: true, x: 0, y: 0, name: "You" },
  { id: "p2", self: false, x: 180, y: 90, name: "bob" },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FullscreenMap", () => {
  it("paints static rooms and labels once across ten live position updates", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    };
    // Only the canvas methods used by this surface are needed in jsdom.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const onClose = vi.fn();
    const { rerender } = render(<FullscreenMap info={info} dots={dots} onClose={onClose} />);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    for (let tick = 0; tick < 10; tick++) {
      rerender(<FullscreenMap info={info} dots={[{ id: "me", self: true, x: tick, y: 5 }]} onClose={onClose} />);
    }
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledTimes(12);
    expect(ctx.arc).toHaveBeenLastCalledWith(9, 5, expect.any(Number), 0, Math.PI * 2);
    rerender(<FullscreenMap info={{ ...info, rooms: [] }} dots={dots} onClose={onClose} />);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    const canvas = document.querySelector(".fullmap-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Fullscreen canvas missing");
    const originalWidth = canvas.width;
    vi.stubGlobal("devicePixelRatio", 2);
    fireEvent(window, new Event("resize"));
    expect(canvas.width).toBe(originalWidth * 2);
    expect(ctx.fillText).toHaveBeenCalledTimes(3);
    const transforms = ctx.setTransform.mock.calls;
    expect(transforms.at(-1)).toEqual(transforms.at(-3));
  });

  it("renders a dialog with a close control", () => {
    render(<FullscreenMap info={info} dots={dots} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Campus map" })).toBeTruthy();
    expect(screen.getByText("Players")).toBeTruthy();
    expect(screen.getByText("Explore Hyprverse Campus!")).toBeTruthy();
    expect(screen.getByLabelText("Close map")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<FullscreenMap info={info} dots={dots} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click and via the close button", () => {
    const onClose = vi.fn();
    const { container } = render(
      <FullscreenMap info={info} dots={dots} onClose={onClose} />,
    );
    const backdrop = container.querySelector(".fullmap-backdrop");
    if (!backdrop) throw new Error("backdrop missing");
    fireEvent.click(backdrop);
    fireEvent.click(screen.getByLabelText("Close map"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // PRD 25.16: an accessible player list is the keyboard/SR alternative to the
  // pointer-only canvas dots.
  it("renders a labelled player list with one locate button per named player", () => {
    render(<FullscreenMap info={info} dots={dots} onClose={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "People on the map" });
    expect(nav).toBeTruthy();
    expect(screen.getByRole("button", { name: "Locate You (you)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Locate bob" })).toBeTruthy();
  });

  it("locates a player from the list via the bus and closes (no teleport)", () => {
    const onClose = vi.fn();
    let located: { id: string } | undefined;
    const off = bus.on<{ id: string }>("locate", (p) => (located = p));
    render(<FullscreenMap info={info} dots={dots} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Locate bob" }));
    expect(located).toEqual({ id: "p2" });
    expect(onClose).toHaveBeenCalledTimes(1);
    off();
  });

  it("shows an empty-state message when no players are named", () => {
    render(<FullscreenMap info={info} dots={[]} onClose={() => {}} />);
    expect(screen.getByText(/No one else is here/i)).toBeTruthy();
  });

  it("locates a clicked player via the bus and closes (view-only, no teleport)", () => {
    const onClose = vi.fn();
    let located: { id: string } | undefined;
    const off = bus.on<{ id: string }>("locate", (p) => (located = p));
    const { container } = render(
      <FullscreenMap info={info} dots={dots} onClose={onClose} />,
    );
    const canvas = container.querySelector(".fullmap-canvas");
    if (!canvas) throw new Error("canvas missing");
    fireEvent.click(canvas, { clientX: 0, clientY: 0 });
    expect(located).toEqual({ id: "me" });
    expect(onClose).toHaveBeenCalledTimes(1);
    off();
  });
});
