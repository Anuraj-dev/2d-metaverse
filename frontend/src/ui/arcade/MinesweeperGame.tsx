import { useCallback, useEffect, useRef, useState } from "react";
import { bus } from "../../game/eventBus";
import {
  initMinesweeper,
  minesChord,
  minesFlag,
  minesMoveCursor,
  minesRemaining,
  minesReveal,
  minesTick,
  type MinesEvent,
  type MinesState,
} from "../../game/arcade/minesweeper";
import { useReducedMotion } from "../reducedMotionBridge";
import type { ArcadeGameProps } from "./gameTypes";

const TICK_MS = 100;

const BUS_FOR_EVENT: Readonly<Partial<Record<MinesEvent, "arcade-point" | "arcade-hit" | "arcade-over" | "arcade-bonus" | "arcade-eat">>> =
  {
    reveal: "arcade-point",
    flag: "arcade-eat",
    unflag: "arcade-eat",
    chord: "arcade-point",
    boom: "arcade-hit",
    win: "arcade-bonus",
  };

function formatClock(ms: number): string {
  const sec = Math.min(999, Math.floor(ms / 1000));
  return String(sec).padStart(3, "0");
}

function cellLabel(state: MinesState, index: number): string {
  const cell = state.cells[index];
  const col = (index % state.cols) + 1;
  const row = Math.floor(index / state.cols) + 1;
  const at = `Row ${row} column ${col}`;
  if (!cell) return at;
  if (state.phase === "lost" && index === state.boomIndex) return `${at}, exploded mine`;
  if (cell.mark === "flag") return `${at}, flagged`;
  if (cell.mark === "hidden") return `${at}, hidden`;
  if (cell.mine) return `${at}, mine`;
  if (cell.adjacent === 0) return `${at}, empty`;
  return `${at}, ${cell.adjacent} adjacent ${cell.adjacent === 1 ? "mine" : "mines"}`;
}

function asStep(state: MinesState): { state: MinesState; events: readonly MinesEvent[] } {
  return { state, events: [] };
}

/**
 * DOM renderer for the pure Minesweeper module. The grid is real buttons so
 * keyboard, pointer, and screen-reader users share one control set. Rules stay
 * in game/arcade/minesweeper.
 *
 * Every transition goes through {@link dispatch}: the ref is the live board and
 * is written before `setState`, so a 100ms tick cannot replay a stale snapshot
 * over a reveal/win, and Arrow-then-Space sees the new cursor.
 */
export default function MinesweeperGame({
  seed,
  paused,
  onScore,
  onGameOver,
}: ArcadeGameProps) {
  const [state, setState] = useState(() => initMinesweeper(seed));
  const stateRef = useRef(state);
  const overRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const dispatch = useCallback((reduce: (prev: MinesState) => { state: MinesState; events: readonly MinesEvent[] }) => {
    if (paused || overRef.current) return;
    const prev = stateRef.current;
    const step = reduce(prev);
    if (step.state === prev && step.events.length === 0) return;
    stateRef.current = step.state;
    setState(step.state);
    if (step.state.score !== prev.score) onScore(step.state.score);
    for (const ev of step.events) {
      const busName = BUS_FOR_EVENT[ev];
      if (busName) bus.emit(busName);
    }
    if (step.state.phase === "won" || step.state.phase === "lost") {
      overRef.current = true;
      if (step.state.phase === "lost") bus.emit("arcade-over");
      onGameOver(step.state.score);
    }
  }, [paused, onScore, onGameOver]);

  const focusCursor = useCallback((index: number) => {
    const el = boardRef.current?.querySelector(`[data-idx="${index}"]`);
    if (el instanceof HTMLButtonElement) el.focus();
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      dispatch((s) => {
        if (s.phase !== "play") return asStep(s);
        return asStep(minesTick(s, TICK_MS));
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || overRef.current) return;
      const move =
        e.key === "ArrowUp" || e.key === "w" || e.key === "W"
          ? "up"
          : e.key === "ArrowDown" || e.key === "s" || e.key === "S"
            ? "down"
            : e.key === "ArrowLeft" || e.key === "a" || e.key === "A"
              ? "left"
              : e.key === "ArrowRight" || e.key === "d" || e.key === "D"
                ? "right"
                : null;
      if (move) {
        e.preventDefault();
        dispatch((s) => asStep(minesMoveCursor(s, move)));
        focusCursor(stateRef.current.cursor);
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        dispatch((s) => minesFlag(s, s.cursor));
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (e.repeat) return;
        dispatch((s) =>
          e.shiftKey ? minesChord(s, s.cursor) : minesReveal(s, s.cursor)
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, dispatch, focusCursor]);

  const remaining = minesRemaining(state);
  const status =
    state.phase === "won"
      ? "Cleared"
      : state.phase === "lost"
        ? "Boom"
        : state.placed
          ? "Sweep"
          : "Pick an opening";
  const over = state.phase === "won" || state.phase === "lost";

  return (
    <div className="arcade-mines" data-reduced={reducedMotion ? "true" : "false"}>
      <div className="arcade-mines-hud">
        <div className="arcade-mines-meter" aria-label={`${remaining} mines remaining`}>
          <span className="arcade-mines-meter-label">Mines</span>
          <span className="arcade-mines-meter-num">{String(remaining).padStart(2, "0")}</span>
        </div>
        <p
          className={`arcade-mines-status${over ? " is-over" : ""}`}
          aria-live={over ? "assertive" : "polite"}
        >
          {status}
        </p>
        <div className="arcade-mines-meter" aria-label={`${formatClock(state.elapsedMs)} seconds`}>
          <span className="arcade-mines-meter-label">Time</span>
          <span className="arcade-mines-meter-num">{formatClock(state.elapsedMs)}</span>
        </div>
      </div>

      <div
        ref={boardRef}
        className="arcade-mines-board"
        role="grid"
        aria-label="Minesweeper board"
        aria-rowcount={state.rows}
        aria-colcount={state.cols}
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
      >
        {state.cells.map((cell, i) => {
          const pressed = cell.mark !== "hidden";
          const classes = [
            "arcade-mines-cell",
            `is-${cell.mark}`,
            cell.mark === "revealed" && cell.mine ? "is-mine" : "",
            i === state.boomIndex ? "is-boom" : "",
            i === state.cursor ? "is-cursor" : "",
            cell.mark === "revealed" && !cell.mine && cell.adjacent > 0 ? `is-n${cell.adjacent}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              data-idx={i}
              className={classes}
              tabIndex={i === state.cursor ? 0 : -1}
              aria-label={cellLabel(state, i)}
              aria-pressed={pressed}
              aria-current={i === state.cursor ? "true" : undefined}
              disabled={over}
              onClick={(e) => {
                if (e.shiftKey) dispatch((s) => minesChord(s, i));
                else dispatch((s) => minesReveal(s, i));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                dispatch((s) => minesFlag(s, i));
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                dispatch((s) => minesChord(s, i));
              }}
            >
              {cell.mark === "flag" ? (
                <span aria-hidden="true">F</span>
              ) : cell.mark === "revealed" && cell.mine ? (
                <span aria-hidden="true">*</span>
              ) : cell.mark === "revealed" && cell.adjacent > 0 ? (
                cell.adjacent
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="arcade-mines-help">
        Arrows or WASD move · Click or Space opens · Right-click or X flags ·
        Shift+click chords
      </p>
    </div>
  );
}
