import { useEffect, useRef, useState } from "react";
import { bus } from "../game/eventBus";
import { fitScale } from "./minimapScale";

interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface WorldInfo {
  width: number;
  height: number;
  rooms: Room[];
}
interface Dot {
  id: string;
  self: boolean;
  x: number;
  y: number;
}

/** Overview map: world bounds + room footprints + live player dots. Driven by the
 *  existing `positions` event and a one-time `world-info` snapshot. Frontend-only. */
export default function Minimap() {
  const [info, setInfo] = useState<WorldInfo | null>(null);
  const [dots, setDots] = useState<Dot[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const offInfo = bus.on("world-info", (p: WorldInfo) => setInfo(p));
    const offPos = bus.on("positions", (p: { players: Dot[] }) =>
      setDots(p.players.map((d) => ({ id: d.id, self: d.self, x: d.x, y: d.y })))
    );
    return () => {
      offInfo();
      offPos();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !info) return;
    const scale = fitScale(info.width, info.height);
    const cw = Math.round(info.width * scale);
    const ch = Math.round(info.height * scale);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, info.width, info.height);

    // rooms
    ctx.strokeStyle = "rgba(110,168,254,0.55)";
    ctx.fillStyle = "rgba(110,168,254,0.10)";
    ctx.lineWidth = 1 / scale;
    for (const r of info.rooms) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    // players
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.self ? 5 / scale : 4 / scale, 0, Math.PI * 2);
      ctx.fillStyle = d.self ? "#7ee787" : "#e6e9f0";
      ctx.fill();
      if (d.self) {
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = "#06122b";
        ctx.stroke();
      }
    }
  }, [info, dots]);

  if (!info) return null;
  return (
    <div className="minimap">
      <canvas ref={canvasRef} />
    </div>
  );
}
