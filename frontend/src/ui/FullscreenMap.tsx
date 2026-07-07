import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { bus } from "../game/eventBus";
import { areaLabels, nearestDot } from "../game/mapView";
import { fitScale } from "./minimapScale";
import type { TerrainInfo } from "./minimapTerrain";

export interface MapArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MapRoom {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MapDotFull {
  id: string;
  self: boolean;
  x: number;
  y: number;
  name?: string | undefined;
}
export interface FullMapInfo {
  width: number;
  height: number;
  rooms: MapRoom[];
  areas?: MapArea[];
  terrain?: TerrainInfo | null;
}

export interface FullscreenMapProps {
  info: FullMapInfo;
  dots: MapDotFull[];
  onClose: () => void;
}

/**
 * Fullscreen campus map (PRD 20). View-only — no teleport. Renders the same
 * rasterized terrain as the minimap at a larger scale, plus room/area rects,
 * AREA_NAMES labels, and live player dots. Hover shows a name; clicking a player
 * pans the world camera via the shared `locate` seam and closes the map. Esc or a
 * click on the backdrop closes instantly; the scene captures movement keys while
 * open (WorldScene reacts to the `map-open`/`map-close` events emitted by Minimap).
 */
export default function FullscreenMap({ info, dots, onClose }: FullscreenMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; name: string } | null>(null);

  // The rasterized terrain, one offscreen pixel per tile (shared with the minimap).
  const terrainCanvas = useMemo(() => {
    const t = info.terrain;
    if (!t) return null;
    const c = document.createElement("canvas");
    c.width = t.cols;
    c.height = t.rows;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    for (let y = 0; y < t.rows; y++) {
      for (let x = 0; x < t.cols; x++) {
        const color = t.colors[y * t.cols + x];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }, [info.terrain]);

  // Aspect-preserving scale into ~86% of the viewport.
  const scale = useMemo(() => {
    const maxW = Math.max(320, window.innerWidth * 0.86);
    const maxH = Math.max(240, window.innerHeight * 0.82);
    return fitScale(info.width, info.height, maxW, maxH);
  }, [info.width, info.height]);

  const cw = Math.round(info.width * scale);
  const ch = Math.round(info.height * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, info.width, info.height);

    if (terrainCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrainCanvas, 0, 0, info.width, info.height);
    }

    // Private-room footprints.
    ctx.strokeStyle = "rgba(110,168,254,0.75)";
    ctx.fillStyle = "rgba(110,168,254,0.14)";
    ctx.lineWidth = 1 / scale;
    for (const r of info.rooms) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    // Area-name labels from the AREA_NAMES registry.
    ctx.fillStyle = "#eef2ff";
    ctx.strokeStyle = "rgba(6,10,20,0.85)";
    ctx.lineWidth = 3 / scale;
    ctx.font = `${Math.round(15 / scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of areaLabels(info.areas ?? [])) {
      ctx.strokeText(label.name, label.cx, label.cy);
      ctx.fillText(label.name, label.cx, label.cy);
    }

    // Live player dots.
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, (d.self ? 6 : 5) / scale, 0, Math.PI * 2);
      ctx.fillStyle = d.self ? "#7ee787" : "#e6e9f0";
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = "#06122b";
      ctx.stroke();
    }
  }, [info, dots, terrainCanvas, scale, cw, ch]);

  // Esc closes; the scene already has movement captured via map-open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Map a canvas-local point to world coords.
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    if (!w) return;
    const id = nearestDot(dots, w.x, w.y, 24 / scale);
    const dot = id ? dots.find((d) => d.id === id) : undefined;
    setHover(dot?.name ? { x: e.clientX, y: e.clientY, name: dot.name } : null);
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    if (!w) return;
    const id = nearestDot(dots, w.x, w.y, 24 / scale);
    if (id) {
      bus.emit("locate", { id });
      onClose();
    }
  };

  return (
    <div className="fullmap-backdrop" onClick={onClose} role="dialog" aria-label="Campus map">
      <div className="fullmap-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fullmap-head">
          <span>Campus map</span>
          <button
            type="button"
            className="icon-btn fullmap-close"
            onClick={onClose}
            aria-label="Close map"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <canvas
          ref={canvasRef}
          className="fullmap-canvas"
          style={{ width: `${cw}px`, height: `${ch}px` }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
        />
        {hover && (
          <div className="fullmap-tip" style={{ left: hover.x, top: hover.y }}>
            {hover.name}
          </div>
        )}
      </div>
    </div>
  );
}
