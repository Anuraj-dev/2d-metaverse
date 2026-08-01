import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
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

function renderPanel(snapshot: BoardUpdatePayload) {
  return render(
    <BoardTablePanel
      snapshot={snapshot}
      selfId="spectator"
      error={null}
      onMove={noop}
      onAccept={noop}
      onLeave={noop}
    />
  );
}

afterEach(cleanup);

// Round-1 finding: a spectator mounting the panel over an active table must see
// the historical pieces already settled — only marks that appear via a
// 0→filled snapshot TRANSITION animate (`is-new`).
describe("BoardTablePanel — mark animation gating", () => {
  it("renders historical marks without the animation class on mount", () => {
    const { container } = renderPanel(
      snap({ state: tttState([1, 2, 1, 0, 2, 0, 0, 0, 0]) })
    );
    expect(container.querySelectorAll(".board-mark")).toHaveLength(4);
    expect(container.querySelectorAll(".is-new")).toHaveLength(0);
  });

  it("animates only the mark that appeared since the previous snapshot", () => {
    const { container, rerender } = renderPanel(
      snap({ state: tttState([1, 2, 0, 0, 0, 0, 0, 0, 0]) })
    );
    rerender(
      <BoardTablePanel
        snapshot={snap({ state: tttState([1, 2, 0, 0, 1, 0, 0, 0, 0], 2) })}
        selfId="spectator"
        error={null}
        onMove={noop}
        onAccept={noop}
        onLeave={noop}
      />
    );
    const fresh = container.querySelectorAll(".is-new");
    expect(fresh).toHaveLength(1);
    // The new mark sits in cell 4 (aria-labelled button wraps the mark).
    expect(fresh[0]?.closest("button")?.getAttribute("aria-label")).toContain("cell 4");
    // A later re-render with the SAME snapshot keeps the flag (no mid-flight
    // animation cancellation) and still animates nothing else.
    rerender(
      <BoardTablePanel
        snapshot={snap({ state: tttState([1, 2, 0, 0, 1, 0, 0, 0, 0], 2) })}
        selfId="spectator"
        error={"nope"}
        onMove={noop}
        onAccept={noop}
        onLeave={noop}
      />
    );
    expect(container.querySelectorAll(".is-new")).toHaveLength(1);
  });

  it("gates Connect-4 discs the same way", () => {
    const empty42 = Array<BoardCell>(42).fill(0);
    const filled = [...empty42];
    filled[35] = 1; // bottom-left disc already played before we mounted
    const { container, rerender } = renderPanel(
      snap({ tableId: "c4-1", game: "connect4", state: { ...tttState(filled) } })
    );
    expect(container.querySelectorAll(".board-disc")).toHaveLength(1);
    expect(container.querySelectorAll(".board-disc.is-new")).toHaveLength(0);

    const next = [...filled];
    next[36] = 2;
    rerender(
      <BoardTablePanel
        snapshot={snap({ tableId: "c4-1", game: "connect4", state: { ...tttState(next, 2) } })}
        selfId="spectator"
        error={null}
        onMove={noop}
        onAccept={noop}
        onLeave={noop}
      />
    );
    expect(container.querySelectorAll(".board-disc")).toHaveLength(2);
    expect(container.querySelectorAll(".board-disc.is-new")).toHaveLength(1);
  });
});
