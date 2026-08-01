import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { bus } from "../game/eventBus";
import { areaLabels, nearestDot } from "../game/mapView";
import { fitScale } from "./minimapScale";
import type { TerrainInfo } from "./minimapTerrain";
import Dialog from "./Dialog";

const OTHER_PLAYER_COLORS = ["#2f80b7", "#7650a8", "#c65373", "#d29223"] as const;

function playerColor(dot: MapDotFull, index: number): string {
  return dot.self ? "#4c9b45" : OTHER_PLAYER_COLORS[index % OTHER_PLAYER_COLORS.length] ?? "#2f80b7";
}

function labelPalette(id: string): { fill: string; border: string; ink: string } {
  const normalized = id.toLowerCase();
  if (normalized.includes("hostel") || normalized.includes("cauvery") || normalized.includes("mandakini")) {
    return { fill: "#617e9e", border: "#3c526c", ink: "#fff3cf" };
  }
  if (normalized.includes("stage")) {
    return { fill: "#88618f", border: "#614367", ink: "#fff3cf" };
  }
  if (normalized.includes("arcade")) {
    return { fill: "#9b6044", border: "#6d402c", ink: "#fff3cf" };
  }
  return { fill: "#e7d69c", border: "#754525", ink: "#382718" };
}

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

  // Aspect-preserving scale that reserves room for the pinned player roster.
  // The former calculation sized the canvas to the viewport before adding the
  // sidebar, which could push the dialog beyond the visible screen.
  const scale = useMemo(() => {
    const compact = window.innerWidth < 760;
    const maxW = compact
      ? Math.max(240, window.innerWidth - 56)
      : Math.max(320, Math.min(window.innerWidth * 0.68, window.innerWidth - 340));
    const maxH = Math.max(240, window.innerHeight * (compact ? 0.5 : 0.74));
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
    ctx.strokeStyle = "rgba(117,69,37,0.82)";
    ctx.fillStyle = "rgba(243,230,178,0.18)";
    ctx.lineWidth = 2 / scale;
    for (const r of info.rooms) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    // Area-name labels from the AREA_NAMES registry.
    ctx.font = `800 ${Math.round(13 / scale)}px Nunito, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of areaLabels(info.areas ?? [])) {
      const palette = labelPalette(`${label.id} ${label.name}`);
      const labelWidth = ctx.measureText(label.name).width + 16 / scale;
      const labelHeight = 24 / scale;
      ctx.fillStyle = palette.fill;
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 2 / scale;
      ctx.fillRect(label.cx - labelWidth / 2, label.cy - labelHeight / 2, labelWidth, labelHeight);
      ctx.strokeRect(label.cx - labelWidth / 2, label.cy - labelHeight / 2, labelWidth, labelHeight);
      ctx.fillStyle = palette.ink;
      ctx.fillText(label.name, label.cx, label.cy);
    }

    // Live player dots.
    dots.forEach((d, index) => {
      ctx.beginPath();
      ctx.arc(d.x, d.y, (d.self ? 6 : 5) / scale, 0, Math.PI * 2);
      ctx.fillStyle = playerColor(d, index);
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = "#382718";
      ctx.stroke();
    });
  }, [info, dots, terrainCanvas, scale, cw, ch]);

  // Esc, focus containment, and background inertness are owned by the Dialog
  // primitive; the scene already has movement captured via map-open.

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

  // Pan the world camera to a player and close (the shared view-only `locate`
  // seam — no teleport). Reused by the canvas hit-test and the keyboard list.
  const locate = (id: string) => {
    bus.emit("locate", { id });
    onClose();
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    if (!w) return;
    const id = nearestDot(dots, w.x, w.y, 24 / scale);
    if (id) locate(id);
  };

  // Named players get a keyboard/screen-reader-operable list alongside the
  // canvas — the canvas dots are pointer-only, so this is the accessible
  // alternative for the same locate action (PRD 25.16).
  const namedDots = dots.filter((d) => d.name);

  return (
    <Dialog
      onClose={onClose}
      label="Campus map"
      backdropClassName="fullmap-backdrop"
      className="fullmap-panel"
    >
      <div className="fullmap-head">
        <span className="fullmap-title">Campus map</span>
        <button
          type="button"
          className="icon-btn fullmap-close"
          onClick={onClose}
          aria-label="Close map"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="fullmap-body">
        <canvas
          ref={canvasRef}
          className="fullmap-canvas"
          style={{ width: `${cw}px`, height: `${ch}px` }}
          aria-hidden="true"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
        />
        <nav className="fullmap-people" aria-label="People on the map">
          <div className="fullmap-people-title">Players</div>
          {namedDots.length === 0 ? (
            <p className="fullmap-people-empty">No one else is here right now.</p>
          ) : (
            <ul className="fullmap-people-list">
              {namedDots.map((d, index) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="fullmap-person"
                    aria-label={`Locate ${d.name}${d.self ? " (you)" : ""}`}
                    onClick={() => locate(d.id)}
                  >
                    <span
                      className="fullmap-person-dot"
                      data-self={d.self}
                      style={{ background: playerColor(d, index) }}
                      aria-hidden="true"
                    />
                    <span className="fullmap-person-name">
                      {d.name}
                      {d.self ? " (you)" : ""}
                    </span>
                    <span className="fullmap-person-action">Locate</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="fullmap-note">Explore Hyprverse Campus!</p>
        </nav>
      </div>
      {hover && (
        <div className="fullmap-tip" style={{ left: hover.x, top: hover.y }}>
          {hover.name}
        </div>
      )}
    </Dialog>
  );
}
