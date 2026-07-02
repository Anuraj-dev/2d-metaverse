import { useRef, useState } from "react";
import { bus } from "../game/eventBus";

const R = 46; // joystick travel radius (px)
const MOBILE_LANDSCAPE_QUERY =
  "(max-width: 960px) and (orientation: landscape) and (pointer: coarse)";

/** On-screen joystick + action button for touch devices. Feeds the game an analog
 *  vector via `move-axis` and triggers sit/stand via `do-interact`. */
export default function TouchControls() {
  const isTouchDevice =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  const isMobileLandscape =
    typeof window !== "undefined" &&
    window.matchMedia?.(MOBILE_LANDSCAPE_QUERY).matches;
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  if (!isTouchDevice || !isMobileLandscape) return null;

  const apply = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const mag = Math.hypot(dx, dy);
    if (mag > R) {
      dx = (dx / mag) * R;
      dy = (dy / mag) * R;
    }
    setThumb({ x: dx, y: dy });
    bus.emit("move-axis", { x: dx / R, y: dy / R });
  };

  const start = (e: React.PointerEvent) => {
    activeId.current = e.pointerId;
    (e.target as Element).setPointerCapture(e.pointerId);
    apply(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (activeId.current === e.pointerId) apply(e.clientX, e.clientY);
  };
  const end = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    setThumb({ x: 0, y: 0 });
    bus.emit("move-axis", { x: 0, y: 0 });
  };

  return (
    <div className="touch-controls">
      <div
        ref={baseRef}
        className="joystick"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          className="joystick-thumb"
          style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
        />
      </div>
      <button
        className="touch-action"
        onPointerDown={(e) => {
          e.preventDefault();
          bus.emit("do-interact");
        }}
      >
        E
      </button>
    </div>
  );
}
