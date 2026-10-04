import { useCallback, useEffect, useRef, useState } from "react";
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
  const [isMobileLandscape, setMobileLandscape] = useState(
    () => window.matchMedia?.(MOBILE_LANDSCAPE_QUERY).matches ?? false,
  );
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  const stop = useCallback(() => {
    if (activeId.current === null) return;
    activeId.current = null;
    setThumb({ x: 0, y: 0 });
    bus.emit("move-axis", { x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.(MOBILE_LANDSCAPE_QUERY);
    const onChange = () => {
      stop();
      setMobileLandscape(media?.matches ?? false);
    };
    const onVisibility = () => { if (document.hidden) stop(); };
    media?.addEventListener("change", onChange);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      media?.removeEventListener("change", onChange);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      // Releasing the UI must never leave a movement vector latched in Phaser.
      if (activeId.current !== null) {
        activeId.current = null;
        bus.emit("move-axis", { x: 0, y: 0 });
      }
    };
  }, [stop]);

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
    if (activeId.current !== null) return;
    activeId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (activeId.current === e.pointerId) apply(e.clientX, e.clientY);
  };
  const end = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    stop();
  };

  return (
    <div className="touch-controls">
      <div
        ref={baseRef}
        className="joystick"
        role="group"
        aria-label="Movement joystick"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <div
          className="joystick-thumb"
          style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
        />
      </div>
      <button
        type="button"
        className="touch-action"
        aria-label="Interact"
        onClick={() => bus.emit("do-interact")}
      >
        E
      </button>
    </div>
  );
}
