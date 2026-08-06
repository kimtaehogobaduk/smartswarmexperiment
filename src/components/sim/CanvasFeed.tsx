import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAP_SIZE, COARSE, COARSE_SIZE, TILE_FURNITURE, TILE_WALL } from "@/sim/map";
import { SENSOR, type Simulation } from "@/sim/engine";

interface Props {
  sim: Simulation | null;
  paused: boolean;
  speed: number;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 14;

function buildMapLayer(sim: Simulation) {
  const c = document.createElement("canvas");
  c.width = MAP_SIZE;
  c.height = MAP_SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
  for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
    const t = sim.map.tiles[i];
    const x = i % MAP_SIZE;
    const y = (i - x) / MAP_SIZE;
    const o = i * 4;
    // Outer 2-tile border — bright amber/gold ring
    const isOuterBorder = x < 2 || x >= MAP_SIZE - 2 || y < 2 || y >= MAP_SIZE - 2;
    if (isOuterBorder) {
      img.data[o]     = 200;
      img.data[o + 1] = 145;
      img.data[o + 2] = 20;
    } else if (t === TILE_WALL) {
      img.data[o]     = 65;
      img.data[o + 1] = 110;
      img.data[o + 2] = 100;
    } else if (t === TILE_FURNITURE) {
      img.data[o]     = 90;
      img.data[o + 1] = 140;
      img.data[o + 2] = 120;
    } else {
      // floor — noticeably brighter than before
      img.data[o]     = 38;
      img.data[o + 1] = 78;
      img.data[o + 2] = 68;
    }
    img.data[o + 3] = 255;
  }
  // doorway markers — bright teal so openings are obvious
  for (const d of sim.map.doorways) {
    for (let dy = d.y; dy < d.y + d.h; dy++) {
      for (let dx = d.x; dx < d.x + d.w; dx++) {
        const o = (dy * MAP_SIZE + dx) * 4;
        img.data[o]     = 40;
        img.data[o + 1] = 200;
        img.data[o + 2] = 150;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function CanvasFeed({ sim, paused, speed }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapLayer = useRef<HTMLCanvasElement | null>(null);
  const fogLayer = useRef<HTMLCanvasElement | null>(null);
  const cam = useRef({ x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 1.4 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [clock, setClock] = useState("--:--:--");
  const [zoomLabel, setZoomLabel] = useState(1.4);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sim) return;
    mapLayer.current = buildMapLayer(sim);
    const fog = document.createElement("canvas");
    fog.width = COARSE_SIZE;
    fog.height = COARSE_SIZE;
    fogLayer.current = fog;
  }, [sim]);

  const reset = useCallback(() => {
    const el = wrapRef.current;
    const fit = el ? Math.min(el.clientWidth, el.clientHeight) / MAP_SIZE : 1.4;
    cam.current = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: Math.max(MIN_ZOOM, fit) };
    setZoomLabel(cam.current.zoom);
  }, []);

  useEffect(() => {
    reset();
  }, [reset]);

  // wheel zoom anchored at the cursor (native, non-passive)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const c = cam.current;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, c.zoom * Math.exp(-dy * 0.0018)),
      );
      // keep the world point under the cursor fixed
      const wx = c.x + (px - rect.width / 2) / c.zoom;
      const wy = c.y + (py - rect.height / 2) / c.zoom;
      c.x = wx - (px - rect.width / 2) / next;
      c.y = wy - (py - rect.height / 2) / next;
      c.zoom = next;
      setZoomLabel(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const c = cam.current;
    c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
    setZoomLabel(c.zoom);
  };

  // render loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0d1f1b";
      ctx.fillRect(0, 0, w, h);
      if (!sim || !mapLayer.current) return;

      const c = cam.current;
      const z = c.zoom;
      // visible tile window (viewport culling)
      const x0 = Math.max(0, c.x - w / (2 * z));
      const y0 = Math.max(0, c.y - h / (2 * z));
      const x1 = Math.min(MAP_SIZE, c.x + w / (2 * z));
      const y1 = Math.min(MAP_SIZE, c.y + h / (2 * z));
      const toScreenX = (wx: number) => (wx - c.x) * z + w / 2;
      const toScreenY = (wy: number) => (wy - c.y) * z + h / 2;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        mapLayer.current,
        x0,
        y0,
        x1 - x0,
        y1 - y0,
        toScreenX(x0),
        toScreenY(y0),
        (x1 - x0) * z,
        (y1 - y0) * z,
      );

      // fog of war from the team's explored coarse grid
      const fog = fogLayer.current;
      if (fog) {
        const fctx = fog.getContext("2d")!;
        const img = fctx.createImageData(COARSE_SIZE, COARSE_SIZE);
        for (let i = 0; i < COARSE_SIZE * COARSE_SIZE; i++) {
          const o = i * 4;
          img.data[o] = 8;
          img.data[o + 1] = 20;
          img.data[o + 2] = 18;
          img.data[o + 3] = sim.explored[i] ? 0 : 175;
        }
        fctx.putImageData(img, 0, 0);
        ctx.drawImage(
          fog,
          x0 / COARSE,
          y0 / COARSE,
          (x1 - x0) / COARSE,
          (y1 - y0) / COARSE,
          toScreenX(x0),
          toScreenY(y0),
          (x1 - x0) * z,
          (y1 - y0) * z,
        );
      }

      // grid ticks
      if (z > 1.2) {
        ctx.strokeStyle = "rgba(80,200,150,0.09)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const step = 25;
        for (let gx = Math.ceil(x0 / step) * step; gx < x1; gx += step) {
          ctx.moveTo(toScreenX(gx), toScreenY(y0));
          ctx.lineTo(toScreenX(gx), toScreenY(y1));
        }
        for (let gy = Math.ceil(y0 / step) * step; gy < y1; gy += step) {
          ctx.moveTo(toScreenX(x0), toScreenY(gy));
          ctx.lineTo(toScreenX(x1), toScreenY(gy));
        }
        ctx.stroke();
      }

      // targets — always visible to the human viewer; bots only know via sensors
      for (let i = 0; i < sim.targets.length; i++) {
        const t = sim.targets[i]!;
        const sx = toScreenX(t.x);
        const sy = toScreenY(t.y);
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
        const cellExplored = sim.explored[
          Math.floor(t.y / COARSE) * COARSE_SIZE + Math.floor(t.x / COARSE)
        ];
        const r = Math.max(4, z * 1.6);
        // found=green, bot-detected-not-yet-found=amber, hidden-from-bots=dim magenta
        let stroke: string;
        let fill: string;
        if (t.found) {
          stroke = "rgba(120,255,180,0.95)";
          fill   = "rgba(120,255,180,0.9)";
        } else if (cellExplored) {
          stroke = "rgba(255,190,80,0.85)";
          fill   = "rgba(255,190,80,0.8)";
        } else {
          // viewer-only: bots have no idea this target exists yet
          stroke = "rgba(220,80,180,0.55)";
          fill   = "rgba(220,80,180,0.5)";
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = t.found || cellExplored ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.moveTo(sx - r - 3, sy);
        ctx.lineTo(sx + r + 3, sy);
        ctx.moveTo(sx, sy - r - 3);
        ctx.lineTo(sx, sy + r + 3);
        ctx.stroke();
        ctx.fillStyle = fill;
        ctx.font = "9px 'JetBrains Mono', monospace";
        const label = t.found
          ? `T${i + 1} ${t.foundAt?.toFixed(1)}s`
          : cellExplored
            ? `T${i + 1}`
            : `T${i + 1} ?`;
        ctx.fillText(label, sx + r + 5, sy - 4);
      }

      // robots: FOV cones + bodies
      for (const r of sim.robots) {
        const sx = toScreenX(r.x);
        const sy = toScreenY(r.y);
        if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 40) continue;
        const range = SENSOR.RANGE * z;
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(range, 1));
        grad.addColorStop(0, "rgba(110,255,190,0.20)");
        grad.addColorStop(1, "rgba(110,255,190,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, range, r.heading - SENSOR.FOV / 2, r.heading + SENSOR.FOV / 2);
        ctx.closePath();
        ctx.fill();

        const size = Math.max(2.5, z * 0.9);
        const bodyColor = r.waiting ? "rgba(255,170,60,0.95)" : "rgba(150,255,205,0.95)";

        // Round body
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();

        // Eye: small filled dot on the front edge, pointing in heading direction
        const eyeDist = size * 0.72;
        const ex = sx + Math.cos(r.heading) * eyeDist;
        const ey = sy + Math.sin(r.heading) * eyeDist;
        const eyeR = Math.max(1, size * 0.28);
        ctx.fillStyle = r.waiting ? "rgba(20,10,0,0.9)" : "rgba(0,18,12,0.9)";
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-grab overflow-hidden bg-background select-none active:cursor-grabbing"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY };
        cam.current.x -= dx / cam.current.zoom;
        cam.current.y -= dy / cam.current.zoom;
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="feed-scanlines" />
      <div className="feed-vignette" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 p-3 font-mono text-[11px] text-hud">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
            <span className="tracking-[0.25em]">LIVE TRANSMISSION · CAM_01</span>
          </div>
          <div className="text-right leading-relaxed">
            <div>{clock} UTC</div>
            <div className="text-hud-dim">
              T+{(sim?.time ?? 0).toFixed(1)}s · {paused ? "PAUSED" : `${speed}x`}
            </div>
          </div>
        </div>
        <div className="absolute bottom-3 left-3 space-y-0.5 text-hud-dim">
          <div>
            MODE {sim?.config.mode === "central" ? "CENTRALIZED TOWER" : "SWARM INTELLIGENCE"}
          </div>
          <div>
            GRID 500×500 · UNITS {sim?.robots.length ?? 0} · ZOOM {zoomLabel.toFixed(2)}x
          </div>
        </div>
        <Crosshair className="absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-hud/25" />
      </div>

      <div className="absolute top-3 right-3 flex gap-1">
        <Button size="icon" variant="outline" className="size-7" onClick={() => zoomBy(1.25)}>
          <Plus className="size-3.5" />
        </Button>
        <Button size="icon" variant="outline" className="size-7" onClick={() => zoomBy(0.8)}>
          <Minus className="size-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[10px]" onClick={reset}>
          <RotateCcw className="size-3" /> RESET VIEWPORT
        </Button>
      </div>
    </div>
  );
}