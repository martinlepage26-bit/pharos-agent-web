"use client";

import { useEffect, useRef } from "react";
import { layoutGraph, type Graph, type LayoutPoint } from "@/lib/graphLayout";

/**
 * The vault orb, ported from the first HUD. A point cloud on a sphere:
 * every point a note Martin wrote, every line a wikilink he made.
 * Edges are precomputed once and only rotated per frame, so the cost
 * stays flat. Lime through violet — domains identifiable without a legend.
 */
export default function VaultOrb({
  graph,
  energyRef,
  label,
}: {
  graph: Graph | null;
  energyRef?: React.MutableRefObject<number>;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const ptsRef = useRef<LayoutPoint[]>([]);
  const edgesRef = useRef<[number, number][]>([]);

  useEffect(() => {
    if (graph && graph.nodes?.length) {
      const laid = layoutGraph(graph);
      graphRef.current = graph;
      ptsRef.current = laid.pts;
      edgesRef.current = laid.edges;
    }
  }, [graph]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx0 = cv.getContext("2d");
    if (!ctx0) return;
    const canvas = cv;
    const ctx = ctx0;

    function hue(h: number, a: number) {
      const r = Math.round(200 - h * 33), g2 = Math.round(255 - h * 116), b = Math.round(61 + h * 189);
      return `rgba(${r},${g2},${b},${a})`;
    }

    let W = 0, H = 0, dpr = 1;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    size();

    let t = 0, energy = 0;
    let proj: Array<{ x: number; y: number; z: number; a: number; b: number; s: number; h: number }> = [];

    function floor(cx: number, cy: number, S: number) {
      ctx.strokeStyle = "rgba(167,139,250,.08)";
      ctx.lineWidth = 0.5;
      const top = cy + S * 0.86, span = H - top;
      if (span <= 0) return;
      for (let i = 1; i <= 7; i++) {
        const f = Math.pow(i / 7, 1.9), y = top + span * f;
        ctx.globalAlpha = 1 - f * 0.55;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      for (let i = -9; i <= 9; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * S * 0.13, top);
        ctx.lineTo(cx + i * S * 1.5, H);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    let raf = 0;
    (function frame() {
      raf = requestAnimationFrame(frame);
      if (energyRef) energy = Math.max(energy, energyRef.current);
      if (!W) return;
      t += 0.0020 + energy * 0.0045;
      energy *= 0.985;
      if (energyRef) energyRef.current = energy;
      const cx = W / 2, cy = H * 0.40, S = Math.min(W, H) * 0.30;
      const ca = Math.cos(t), sa = Math.sin(t), cb = Math.cos(0.38), sb = Math.sin(0.38);

      ctx.clearRect(0, 0, W, H);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 2.2);
      g.addColorStop(0, `rgba(200,255,61,${0.10 + energy * 0.12})`);
      g.addColorStop(0.42, "rgba(124,58,237,.10)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      floor(cx, cy, S);

      const pts = ptsRef.current, edges = edgesRef.current;
      if (!pts.length) {
        ctx.fillStyle = "rgba(228,220,245,.30)";
        ctx.font = "10px ui-monospace,SF Mono,Menlo,monospace";
        ctx.textAlign = "center";
        ctx.fillText("READING VAULT…", cx, cy);
        ctx.textAlign = "left";
        return;
      }

      const N = pts.length;
      if (proj.length !== N) proj = new Array(N);
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const x1 = p.x * ca - p.z * sa, z1 = p.x * sa + p.z * ca;
        const y1 = p.y * cb - z1 * sb, z2 = p.y * sb + z1 * cb;
        const k = 1 / (2.7 - z2);
        proj[i] = {
          x: cx + x1 * S * k * 2.7, y: cy + y1 * S * k * 2.7, z: z2,
          a: (z2 + 1) / 2, b: 0.5 + 0.5 * Math.sin(t * 8 + p.p), s: p.s, h: p.h,
        };
      }

      const buckets: Array<Array<{ x: number; y: number }>> = [[], [], []];
      for (let e = 0; e < edges.length; e++) {
        const a = proj[edges[e][0]], b = proj[edges[e][1]];
        const m = (a.a + b.a) / 2;
        if (m < 0.42) continue;
        buckets[m > 0.82 ? 2 : m > 0.62 ? 1 : 0].push(a, b);
      }
      const alphas = [0.030, 0.065, 0.115];
      ctx.lineWidth = 0.5;
      for (let bi = 0; bi < 3; bi++) {
        const list = buckets[bi];
        if (!list.length) continue;
        ctx.strokeStyle = `rgba(167,139,250,${alphas[bi] + energy * 0.05})`;
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 2) {
          ctx.moveTo(list[i].x, list[i].y);
          ctx.lineTo(list[i + 1].x, list[i + 1].y);
        }
        ctx.stroke();
      }

      for (let i = 0; i < N; i++) {
        const p = proj[i];
        const al = Math.min(0.95, Math.pow(p.a, 1.9) * (0.30 + 0.55 * p.b) + energy * 0.1);
        ctx.fillStyle = p.z < 0 ? `rgba(167,139,250,${al * 0.7})` : hue(p.h, al);
        ctx.beginPath();
        ctx.arc(p.x, p.y, (0.3 + p.a * 1.05) * p.s, 0, 6.2832);
        ctx.fill();
      }

      const meta = graphRef.current;
      if (meta) {
        ctx.fillStyle = "rgba(228,220,245,.34)";
        ctx.font = "9px ui-monospace,SF Mono,Menlo,monospace";
        ctx.fillText(
          `${label ?? "EMERAULD"} · ${meta.shown ?? N} OF ${meta.total_notes ?? N} NOTES · ${edges.length} LINKS`,
          12, H - 12
        );
      }
    })();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [energyRef, label]);

  return <canvas ref={canvasRef} />;
}
