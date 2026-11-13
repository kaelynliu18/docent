"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { getTasteMap } from "@/lib/server/data";

type Data = Awaited<ReturnType<typeof getTasteMap>>;
type View = { scale: number; tx: number; ty: number };
const PAD = 24;

/**
 * The taste map: every catalogue painting as a faint dot at its precomputed
 * 2D position (similar-looking paintings sit together), your ranked ones as
 * larger dots coloured by tier and sized by score, cluster labels, and dashed
 * rings around big regions you haven't ranked anything in. Canvas, so ~9k
 * points pan and zoom smoothly; drag / wheel / pinch, or the buttons.
 */
export function MapClient({ data }: { data: Data }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);

  const { points, ranked, clusters, unexplored } = data;
  const n = points.id.length;
  const rankedBy = useMemo(() => new Map(ranked.map((r) => [r.id, r])), [ranked]);
  const rankedIdx = useMemo(() => points.id.map((id, i) => (rankedBy.has(id) ? i : -1)).filter((i) => i >= 0), [points.id, rankedBy]);
  const unexploredSet = useMemo(() => new Set(unexplored.map((u) => u.cluster)), [unexplored]);
  // Ring radius per unexplored cluster: median distance of its points from the label point, capped.
  const rings = useMemo(
    () =>
      unexplored.map((u) => {
        const d: number[] = [];
        for (let i = 0; i < n; i++) if (points.cluster[i] === u.cluster) d.push(Math.hypot(points.x[i] - u.x, points.y[i] - u.y));
        d.sort((a, b) => a - b);
        return { ...u, r: Math.min(0.09, d[Math.floor(d.length * 0.5)] ?? 0.05) };
      }),
    [unexplored, n, points],
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setSize({ w, h: Math.round(Math.min(Math.max(w * 0.75, 380), window.innerHeight * 0.7)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toScreen = useCallback(
    (x: number, y: number) => {
      const box = Math.min(size.w, size.h) - PAD * 2;
      const ox = (size.w - box) / 2;
      const oy = (size.h - box) / 2;
      return [(ox + x * box) * view.scale + view.tx, (oy + y * box) * view.scale + view.ty] as const;
    },
    [size, view],
  );

  // Draw.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const tierColour = { loved: v("--loved"), fine: v("--fine"), meh: v("--meh") } as const;
    ctx.clearRect(0, 0, size.w, size.h);

    // Catalogue: faint dots.
    ctx.fillStyle = v("--ink-2");
    ctx.globalAlpha = 0.22;
    const dot = Math.max(1.2, Math.min(3, 1.4 * Math.sqrt(view.scale)));
    for (let i = 0; i < n; i++) {
      const [x, y] = toScreen(points.x[i], points.y[i]);
      if (x < -4 || y < -4 || x > size.w + 4 || y > size.h + 4) continue;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    ctx.globalAlpha = 1;

    // Unexplored regions: dashed rings.
    ctx.strokeStyle = v("--accent");
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    const box = (Math.min(size.w, size.h) - PAD * 2) * view.scale;
    for (const r of rings) {
      const [x, y] = toScreen(r.x, r.y);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(18, r.r * box), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Your rankings: bigger = ranked higher; colour = tier.
    const order = [...rankedIdx].sort((a, b) => rankedBy.get(points.id[a])!.score - rankedBy.get(points.id[b])!.score);
    for (const i of order) {
      const r = rankedBy.get(points.id[i])!;
      const [x, y] = toScreen(points.x[i], points.y[i]);
      const rad = 3 + (r.score / 10) * 6;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = tierColour[r.tier];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = v("--wall");
      ctx.stroke();
    }


    // Cluster labels, drawn last so dots never cover them. Unexplored and bigger clusters
    // get placed first; a label that would overlap one already placed is skipped (zoom to see it).
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const byPriority = [...clusters].sort((a, b) => Number(unexploredSet.has(b.cluster)) - Number(unexploredSet.has(a.cluster)) || b.size - a.size);
    for (const cl of byPriority) {
      const [cx, y] = toScreen(cl.x, cl.y);
      const label = cl.label.length > 34 ? cl.label.slice(0, 33) + "…" : cl.label;
      const w = ctx.measureText(label).width;
      // Keep the whole label on the canvas (narrow phone screens).
      const x = Math.min(Math.max(cx, w / 2 + 6), size.w - w / 2 - 6);
      const box = { x0: x - w / 2 - 4, y0: y - 24, x1: x + w / 2 + 4, y1: y - 4 };
      if (box.x1 < 0 || box.x0 > size.w || box.y1 < 0 || box.y0 > size.h) continue;
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      ctx.lineWidth = 4;
      ctx.strokeStyle = v("--surface");
      ctx.strokeText(label, x, y - 10);
      ctx.fillStyle = unexploredSet.has(cl.cluster) ? v("--accent") : v("--ink");
      ctx.fillText(label, x, y - 10);
    }

    if (hover) {
      const [x, y] = toScreen(points.x[hover.i], points.y[hover.i]);
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = v("--ink");
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [size, view, hover, n, points, rankedIdx, rankedBy, clusters, rings, unexploredSet, toScreen]);

  const nearest = (sx: number, sy: number) => {
    let best = -1, bestD = 14 * 14;
    // Prefer your rankings, then any painting.
    for (const i of rankedIdx) {
      const [x, y] = toScreen(points.x[i], points.y[i]);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    if (best >= 0) return best;
    bestD = 8 * 8;
    for (let i = 0; i < n; i++) {
      const [x, y] = toScreen(points.x[i], points.y[i]);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    return best;
  };

  const zoomAt = (sx: number, sy: number, factor: number) =>
    setView((v) => {
      const scale = Math.min(40, Math.max(1, v.scale * factor));
      const k = scale / v.scale;
      return scale === 1 ? { scale: 1, tx: 0, ty: 0 } : { scale, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
    });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hovered = hover ? { id: points.id[hover.i], title: points.title[hover.i], artist: points.artist[hover.i], mine: rankedBy.get(points.id[hover.i]) } : null;

  return (
    <div>
      <div ref={wrap} className="relative overflow-hidden rounded-2xl border border-line bg-surface">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Map of ${n} paintings arranged by how they look, with your ${ranked.length} ranked paintings highlighted`}
          style={{ width: size.w, height: size.h, touchAction: "none", cursor: hover ? "pointer" : "grab" }}
          onWheel={(e) => {
            const p = local(e);
            zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2);
          }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, local(e));
            dragged.current = false;
          }}
          onPointerMove={(e) => {
            const p = local(e);
            const prev = pointers.current.get(e.pointerId);
            if (prev && pointers.current.size === 1) {
              if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) > 2) dragged.current = true;
              setView((v) => (v.scale === 1 ? v : { ...v, tx: v.tx + p.x - prev.x, ty: v.ty + p.y - prev.y }));
              pointers.current.set(e.pointerId, p);
            } else if (prev && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              const other = a === prev ? b : a;
              const before = Math.hypot(prev.x - other.x, prev.y - other.y);
              const after = Math.hypot(p.x - other.x, p.y - other.y);
              if (before > 0) zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before);
              pointers.current.set(e.pointerId, p);
              dragged.current = true;
            } else {
              const i = nearest(p.x, p.y);
              setHover(i >= 0 ? { i, x: p.x, y: p.y } : null);
            }
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            if (!dragged.current) {
              const p = local(e);
              const i = nearest(p.x, p.y);
              if (i >= 0) {
                if (hover?.i === i || e.pointerType === "mouse") router.push(`/artwork/${points.id[i]}`);
                else setHover({ i, x: p.x, y: p.y });
              }
            }
          }}
          onPointerLeave={() => pointers.current.size === 0 && setHover(null)}
        />
        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-60 rounded-xl border border-line bg-wall px-3 py-2 text-sm shadow-[var(--shadow)]"
            style={{ left: Math.min(hover.x + 14, size.w - 250), top: Math.max(8, hover.y - 64) }}
          >
            <p className="font-serif italic leading-snug">{hovered.title}</p>
            <p className="text-xs text-ink-2">{hovered.artist}</p>
            {hovered.mine && (
              <p className="mt-1 text-xs font-semibold">
                Your #{hovered.mine.rank} · {hovered.mine.score.toFixed(1)}
              </p>
            )}
          </div>
        )}
        <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-xl border border-line bg-wall text-lg">
          <button type="button" aria-label="Zoom in" className="size-10 hover:bg-surface" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.5)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" className="size-10 border-t border-line hover:bg-surface" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.5)}>
            −
          </button>
          <button type="button" aria-label="Reset view" className="size-10 border-t border-line text-xs hover:bg-surface" onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}>
            ⟲
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-loved" /> Loved it</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-fine" /> It was fine</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-meh" /> Not for me</span>
        <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-ink-2 opacity-50" /> Rest of the catalogue</span>
        <span>Bigger dot = ranked higher</span>
      </div>

      {unexplored.length > 0 && (
        <div className="mt-8">
          <h2 className="font-serif text-2xl">Places you haven&apos;t been</h2>
          <p className="text-sm text-ink-2">Big groups of paintings (dashed rings) where you haven&apos;t ranked anything yet.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {unexplored.map((u) => (
              <li key={u.cluster}>
                <Link
                  href={`/recommendations?region=${u.cluster}`}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-ink-2"
                >
                  <span>
                    <span className="block font-medium">{u.label}</span>
                    <span className="text-xs text-ink-2">{u.size} paintings</span>
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
