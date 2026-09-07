"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import VaultOrb from "@/components/VaultOrb";
import { hash32, type Graph } from "@/lib/graphLayout";

/** The Obsidian graph view, back: full-screen vault orb served live
 *  from ~/pharos/state/graph.json. Deterministic layout — a note keeps
 *  its place between reloads. */
export default function GraphView() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [state, setState] = useState<"live" | "lost" | "loading">("loading");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/graph", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const g: Graph = await r.json();
        if (!alive) return;
        if (g.nodes?.length) {
          setGraph(g);
          setState("live");
        } else {
          setState("lost");
        }
      } catch {
        if (alive) setState("lost");
      }
    }
    load();
    const id = setInterval(load, 300000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const domains = graph?.nodes
    ? [...graph.nodes.reduce((m, n) => m.set(n.d, (m.get(n.d) ?? 0) + 1), new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  function domainColor(d: string): string {
    const h = hash32(`domain-hue\u0000${d}`) / 0x100000000;
    const r = Math.round(200 - h * 33), g2 = Math.round(255 - h * 116), b = Math.round(61 + h * 189);
    return `rgb(${r},${g2},${b})`;
  }

  return (
    <main className="graphwrap">
      <VaultOrb graph={graph} />
      <div className="graphhud">
        <div>
          <b>OBSIDIAN VAULT · EMERAULD GRAPH</b>
        </div>
        <div>
          {state === "live"
            ? `${graph?.shown ?? graph?.nodes.length} OF ${graph?.total_notes} NOTES · ${graph?.edges.length} LINKS`
            : state === "loading"
              ? "READING VAULT…"
              : "GRAPH OFFLINE — RUN ~/pharos/hud/graph.py"}
        </div>
        <div style={{ marginTop: 6, color: "var(--dimmer)" }}>
          DETERMINISTIC LAYOUT · A NOTE KEEPS ITS PLACE
        </div>
        <div className="legend">
          {domains.map(([d, count]) => (
            <div key={d} style={{ color: "var(--dimmer)" }}>
              <i style={{ background: domainColor(d) }} />
              {d} · {count}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Link href="/">← CONTROL CENTER</Link>
        </div>
      </div>
    </main>
  );
}
