import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import MinesweeperGame from "./MinesweeperGame";
import { initMinesweeper, minesReveal } from "../../game/arcade/minesweeper";

function mount(props?: { paused?: boolean; onGameOver?: (n: number) => void }) {
  return render(
    <MinesweeperGame
      seed={1}
      paused={props?.paused ?? false}
      shake={false}
      onScore={() => {}}
      onGameOver={props?.onGameOver ?? (() => {})}
    />,
  );
}

function cell(row: number, col: number, suffix = ","): HTMLElement {
  return screen.getByRole("gridcell", { name: new RegExp(`^Row ${row} column ${col}${suffix}`) });
}

describe("MinesweeperGame", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders a labelled 10×10 grid with start instructions", () => {
    mount();
    expect(screen.getByRole("grid", { name: "Minesweeper board" })).toBeTruthy();
    expect(screen.getAllByRole("gridcell")).toHaveLength(100);
    expect(screen.getByText(/Arrows or WASD move/)).toBeTruthy();
    expect(screen.getByLabelText("12 mines remaining")).toBeTruthy();
  });

  it("opens the first cell on click and keeps the opening safe", () => {
    mount();
    fireEvent.click(cell(1, 1));
    const opened = screen.getAllByRole("gridcell").filter(
      (el) => el.getAttribute("aria-pressed") === "true",
    );
    expect(opened.length).toBeGreaterThan(1);
    expect(screen.queryByRole("gridcell", { name: /exploded mine/ })).toBeNull();
  });

  it("flags a hidden cell on right-click", () => {
    mount();
    fireEvent.contextMenu(cell(1, 2, ", hidden$"));
    expect(screen.getByRole("gridcell", { name: /^Row 1 column 2, flagged$/ })).toBeTruthy();
    expect(screen.getByLabelText("11 mines remaining")).toBeTruthy();
  });

  it("does not let a timer tick overwrite a reveal", () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      cell(1, 1).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      vi.advanceTimersByTime(400);
    });
    const opened = screen.getAllByRole("gridcell").filter(
      (el) => el.getAttribute("aria-pressed") === "true",
    );
    expect(opened.length).toBeGreaterThan(1);
    expect(screen.getByText("Sweep")).toBeTruthy();
  });

  it("applies Arrow then Space to the new cursor cell in one turn", () => {
    mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(screen.getByRole("gridcell", { name: /^Row 1 column 2,/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: /^Row 1 column 2,/ }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("freezes input after game-over so a finishing overlay cannot keep playing", () => {
    const onGameOver = vi.fn();
    render(
      <MinesweeperGame
        seed={4}
        paused={false}
        shake={false}
        onScore={() => {}}
        onGameOver={onGameOver}
      />,
    );
    fireEvent.click(cell(1, 1));
    const opened = minesReveal(initMinesweeper(4), 0).state;
    const mine = opened.cells.findIndex((c) => c.mine && c.mark === "hidden");
    expect(mine).toBeGreaterThanOrEqual(0);
    const row = Math.floor(mine / opened.cols) + 1;
    const col = (mine % opened.cols) + 1;
    fireEvent.click(screen.getByRole("gridcell", { name: new RegExp(`^Row ${row} column ${col},`) }));
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Boom")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: " " });
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("gridcell").every((el) => (el as HTMLButtonElement).disabled)).toBe(true);
  });
});
