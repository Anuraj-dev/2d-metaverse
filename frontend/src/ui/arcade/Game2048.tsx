import { useEffect, useRef, useState } from "react";
import { bus } from "../../game/eventBus";
import {
  init2048,
  move2048,
  type Game2048State,
  type Move2048,
} from "../../game/arcade/game2048";
import type { ArcadeGameProps } from "./gameTypes";

const KEY_MOVE: Record<string, Move2048> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

const TILE_CLASS: Record<number, string> = {
  0: "t0",
  2: "t2",
  4: "t4",
  8: "t8",
  16: "t16",
  32: "t32",
  64: "t64",
  128: "t128",
  256: "t256",
  512: "t512",
  1024: "t1024",
  2048: "t2048",
};

/**
 * DOM-grid renderer for the pure 2048 module (move-driven, no tick loop). A new
 * run remounts this component (ArcadeOverlay keys it by seed).
 */
export default function Game2048({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const [state, setState] = useState<Game2048State>(() => init2048(seed));
  const stateRef = useRef(state);
  const overRef = useRef(false);

  // Mirror state into a ref for the keydown handler (updated in an effect, not
  // during render).
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_MOVE[e.key];
      if (!dir) return;
      e.preventDefault();
      if (paused || overRef.current) return;
      const prev = stateRef.current;
      const next = move2048(prev, dir);
      if (next === prev) return; // no-op move
      stateRef.current = next;
      setState(next);
      if (next.score !== prev.score) {
        onScore(next.score);
        bus.emit("arcade-point");
      }
      if (next.over && !overRef.current) {
        overRef.current = true;
        bus.emit("arcade-over");
        onGameOver(next.score);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, onScore, onGameOver]);

  return (
    <div
      className="arcade-2048"
      style={{ gridTemplateColumns: `repeat(${state.size}, 1fr)` }}
    >
      {state.cells.map((value, i) => (
        <div key={i} className={`arcade-tile ${TILE_CLASS[value] ?? "tbig"}`}>
          {value === 0 ? "" : value}
        </div>
      ))}
    </div>
  );
}
