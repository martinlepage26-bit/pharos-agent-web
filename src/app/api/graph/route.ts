import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { recordAudit } from "@/lib/audit";

const GRAPH_PATH =
  process.env.PHAROS_GRAPH_PATH ?? "/Users/pharos_ai/pharos/state/graph.json";

export const dynamic = "force-dynamic";

/**
 * Serves the EMERAULD vault graph live from the PHAROS state directory
 * (built by ~/pharos/hud/graph.py from the Obsidian vault). Read-only,
 * registered in the HUD lineage — same payload the first HUD's orb used.
 */
export async function GET() {
  try {
    const raw = await fs.readFile(GRAPH_PATH, "utf8");
    const graph = JSON.parse(raw);
    if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
      return NextResponse.json({ nodes: [], edges: [], building: true });
    }
    return NextResponse.json(graph, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    await recordAudit({
      eventType: "tool_called",
      actor: "system",
      toolName: "get_vault_graph",
      capability: "documents.search",
      outcome: "failed",
      purpose: e instanceof Error ? e.message.slice(0, 200) : "graph read failed",
    });
    return NextResponse.json(
      { error: "vault graph unavailable", building: false },
      { status: 503 }
    );
  }
}
