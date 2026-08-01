import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BoardUpdatePayload } from "@metaverse/shared";
import BoardTablePanel from "./BoardTablePanel";

const alice = { id: "a", name: "Alice", accepted: true };
const bob = { id: "b", name: "Bob", accepted: true };

function snap(over: Partial<BoardUpdatePayload>): BoardUpdatePayload {
  return {
    tableId: "ttt-1",
    game: "tictactoe",
    phase: "active",
    seats: [alice, bob],
    state: null,
    reason: null,
    ...over,
  };
}

type BoardCell = 0 | 1 | 2;

function tttState(board: BoardCell[], turn: 1 | 2 = 1) {
  return { board, turn, result: { status: "in_progress" as const } };
}

const noop = () => {};

function renderPanel(
  snapshot: BoardUpdatePayload,
  opts: { selfId?: string; error?: string | null; onMove?: (i: number) => void; onAccept?: () => void } = {},
) {
  return render(
    <BoardTablePanel
      snapshot={snapshot}
      selfId={opts.selfId ?? "spectator"}
      error={opts.error ?? null}
      onMove={opts.onMove ?? noop}
      onAccept={opts.onAccept ?? noop}
      onLeave={noop}
    />,
  );
}

afterEach(cleanup);

describe("BoardTablePanel — redesigned surface", () => {
  it("renders seat chips and real X/O marks for an active table", () => {
    const { container } = renderPanel(
      snap({ state: tttState([1, 2, 1, 0, 2, 0, 0, 0, 0]) }),
    );
    expect(screen.getByLabelText("Tic-Tac-Toe table")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Watching")).toBeTruthy();
    // Seat chips each carry a legend mark; count only pieces inside the grid.
    const grid = container.querySelector(".board-grid");
    if (!grid) throw new Error("missing board grid");
    expect(grid.querySelectorAll(".board-mark--p1")).toHaveLength(2);
    expect(grid.querySelectorAll(".board-mark--p2")).toHaveLength(2);
  });

  it("offers Play again to a seated player on a finished non-forfeit match", () => {
    const onAccept = vi.fn();
    renderPanel(
      snap({
        phase: "over",
        reason: "win",
        state: {
          board: [1, 1, 1, 0, 0, 0, 0, 0, 0],
          turn: 1,
          result: { status: "won", winner: 1, line: [0, 1, 2] },
        },
      }),
      { selfId: "a", onAccept },
    );
    const again = screen.getByRole("button", { name: "Play again" });
    fireEvent.click(again);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("renders Connect-4 discs with a distinct ring on seat 1", () => {
    const empty42 = Array<BoardCell>(42).fill(0);
    const filled = [...empty42];
    filled[35] = 1;
    filled[36] = 2;
    const { container } = renderPanel(
      snap({ tableId: "c4-1", game: "connect4", state: tttState(filled, 1) }),
    );
    expect(screen.getByLabelText("Connect 4 table")).toBeTruthy();
    const grid = container.querySelector(".board-grid");
    if (!grid) throw new Error("missing board grid");
    // Two placed discs on the grid (seat-chip legends also render discs).
    expect(grid.querySelectorAll(".board-disc")).toHaveLength(2);
    expect(grid.querySelectorAll(".board-disc__ring")).toHaveLength(1);
  });

  it("animates only the newly placed mark after mount", () => {
    const { container, rerender } = renderPanel(
      snap({ state: tttState([1, 2, 0, 0, 0, 0, 0, 0, 0]) }),
    );
    const grid = container.querySelector(".board-grid");
    if (!grid) throw new Error("missing board grid");
    expect(grid.querySelectorAll(".is-new")).toHaveLength(0);
    rerender(
      <BoardTablePanel
        snapshot={snap({ state: tttState([1, 2, 0, 0, 1, 0, 0, 0, 0], 2) })}
        selfId="spectator"
        error={null}
        onMove={noop}
        onAccept={noop}
        onLeave={noop}
      />,
    );
    expect(grid.querySelectorAll(".is-new")).toHaveLength(1);
  });
});
