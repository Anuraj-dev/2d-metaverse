import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SnakeGame from "./SnakeGame";
import { CELL_CSS, EDGE_INSET } from "./snake/stage";

function mockBox(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: w,
      bottom: h,
      width: w,
      height: h,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("SnakeGame stage fill", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts a scored run at the measured stage size, not a fixed 34x18", () => {
    const cols = 50;
    const rows = 28;
    const w = cols * CELL_CSS + 2 * EDGE_INSET;
    const h = rows * CELL_CSS + 2 * EDGE_INSET;

    const { container } = render(
      <SnakeGame
        seed={1}
        paused={false}
        shake={false}
        onScore={() => {}}
        onGameOver={() => {}}
      />,
    );
    const root = container.querySelector(".arcade-snake-root");
    if (!(root instanceof HTMLElement)) throw new Error("snake root missing");
    mockBox(root, w, h);
    fireEvent(window, new Event("resize"));

    fireEvent.click(screen.getByRole("button", { name: /^normal$/i }));

    const canvas = container.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas missing");
    expect(canvas.style.width).toBe(`${cols * CELL_CSS}px`);
    expect(canvas.style.height).toBe(`${rows * CELL_CSS}px`);
    expect(canvas.width).toBe(cols * CELL_CSS);
    expect(canvas.height).toBe(rows * CELL_CSS);
  });
});
