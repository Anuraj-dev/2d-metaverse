import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

const RING_COUNT = 14;

/**
 * A cold, instrument-grade wireframe sphere — the landing's centrepiece.
 * Layered atmosphere (core glow, grid, vignette) sits behind a 3D mesh of
 * rotating rings. A pointer-driven tilt is written straight to the DOM in a
 * rAF lerp loop (no per-frame React state) and is disabled for reduced motion.
 */
export default function SphereScene() {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (reduce || !root) return;
    const tilt = root.querySelector<HTMLElement>(".ss-tilt");
    const drifters = Array.from(root.querySelectorAll<HTMLElement>("[data-depth]"));
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX / window.innerWidth - 0.5;
      target.y = e.clientY / window.innerHeight - 0.5;
    };
    const tick = () => {
      cur.x += (target.x - cur.x) * 0.07;
      cur.y += (target.y - cur.y) * 0.07;
      if (tilt) {
        tilt.style.transform = `rotateX(${-cur.y * 9}deg) rotateY(${cur.x * 9}deg)`;
      }
      for (const el of drifters) {
        const depth = Number(el.dataset.depth) || 0;
        el.style.transform = `translate3d(${-cur.x * depth}px, ${-cur.y * depth}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  return (
    <div className="sphere-scene" ref={rootRef} aria-hidden="true">
      <div className="ss-grid" data-depth="14" />
      <div className="ss-haze" data-depth="26" />
      <div className="ss-core" data-depth="10" />

      <div className="ss-stage" data-depth="20">
        <div className="ss-tilt">
          <div className={`ss-spin ${reduce ? "still" : ""}`}>
            {Array.from({ length: RING_COUNT }, (_, i) => {
              const step = 180 / RING_COUNT;
              const angle = i * step;
              const axis = i % 2 === 0 ? "Y" : "X";
              return (
                <span
                  key={i}
                  className="ss-ring"
                  style={{ transform: `rotate${axis}(${angle}deg)` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="ss-vignette" />
    </div>
  );
}
