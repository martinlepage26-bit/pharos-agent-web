"use client";

import { useEffect, useRef, useState } from "react";
import VaultOrb from "@/components/VaultOrb";
import type { Graph } from "@/lib/graphLayout";

/**
 * The dashboard's centre stage: the vault orb behind, the brief beacon
 * in front. Pulses when a brief is fired, like the first HUD's orb.
 */
export default function GraphStage({
  briefCount,
  runCount,
  completedCount,
  projects,
}: {
  briefCount: number;
  runCount: number;
  completedCount: number;
  projects: Array<{ key: string; name: string }>;
}) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [link, setLink] = useState<"live" | "lost" | "loading">("loading");
  const energyRef = useRef(0);

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
          setLink("live");
        } else {
          setLink("lost");
        }
      } catch {
        if (alive) setLink("lost");
      }
    }
    load();
    const id = setInterval(load, 300000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const completion = runCount > 0 ? Math.round((completedCount / runCount) * 100) : 0;

  return (
    <div className="stage">
      <VaultOrb graph={graph} energyRef={energyRef} />
      <div className="top-left">
        GRAPH · {link === "live" ? "LIVE" : link === "loading" ? "READING" : "LINK LOST"}
      </div>
      <div className="beacon">
        <div className="k">
          GOVERNED WORKFLOW · <b>BRIEF ME</b>
        </div>
        <div className="big">
          {briefCount}
          <span id="unit">BRIEFS LANDED</span>
        </div>
        <div className="bar">
          <i style={{ width: `${completion}%` }} />
        </div>
        <div className="m">
          READ-ONLY RETRIEVAL · DRAFTS ONLY · {runCount} RUNS · {completion}% CLEAN
        </div>
        <form
          id="brief"
          action="/api/brief"
          method="post"
          style={{ pointerEvents: "auto", marginTop: 16, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}
          onSubmit={() => {
            energyRef.current = 1;
          }}
        >
          <select name="projectKey" defaultValue={projects[0]?.key ?? ""}>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="language" defaultValue="fr-CA">
            <option value="fr-CA">FRANÇAIS · QC</option>
            <option value="en-CA">ENGLISH · CA</option>
            <option value="bilingual">BILINGUE</option>
          </select>
          <button className="btn primary" type="submit">
            BRIEF ME
          </button>
        </form>
      </div>
    </div>
  );
}
