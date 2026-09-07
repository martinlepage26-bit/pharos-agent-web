import Link from "next/link";
import { prisma } from "@/lib/prisma";
import GraphStage from "@/components/GraphStage";
import ReadAloudButton from "@/components/ReadAloudButton";

export const dynamic = "force-dynamic";

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export default async function Dashboard() {
  const [
    projects, sourceCount, chunkCount, auditCount,
    runCount, completedCount, briefCount,
    briefs, runs, audits, directives,
  ] = await Promise.all([
    prisma.project.findMany({ select: { key: true, name: true } }),
    prisma.source.count(),
    prisma.chunk.count(),
    prisma.auditEvent.count(),
    prisma.agentRun.count(),
    prisma.agentRun.count({ where: { status: "completed" } }),
    prisma.briefDraft.count(),
    prisma.briefDraft.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.auditEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 14 }),
    prisma.memoryItem.findMany({
      where: { category: { in: ["decision", "requirement", "architecture", "preference", "milestone"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  const runColour = (s: string) =>
    s === "completed" ? "var(--accent)" : s === "failed" ? "var(--hot)" : "var(--warm)";

  return (
    <main className="hud">
      {/* ------------------------------------------------------------- left */}
      <div className="col l">
        <section>
          <h2>SYSTEM VITALS <em>AGENT · LIVE</em></h2>
          <div className="vital">
            <div className="top"><b>▸</b>PROJECTS<span>REGISTERED</span></div>
            <div className="n">{projects.length}</div>
          </div>
          <div className="vital">
            <div className="top"><b>▸</b>INDEXED CHUNKS<span>PGVECTOR</span></div>
            <div className="n">{chunkCount.toLocaleString()}</div>
          </div>
          <div className="vital">
            <div className="top"><b>▸</b>SOURCES<span>APPROVED</span></div>
            <div className="n">{sourceCount}</div>
          </div>
          <div className="vital">
            <div className="top"><b>▸</b>AUDIT EVENTS<span>APPEND-ONLY</span></div>
            <div className="n">{auditCount.toLocaleString()}</div>
          </div>
        </section>

        <section>
          <h2>DIRECTIVES <em>MEMORY</em></h2>
          <div className="scroll" style={{ maxHeight: 200 }}>
            {directives.length ? (
              directives.map((m) => (
                <div className="row" key={m.id}>
                  <b>{(m.category ?? "note").toUpperCase()}</b> &nbsp;{m.statement}
                </div>
              ))
            ) : (
              <div className="empty">No directives in memory yet.</div>
            )}
          </div>
        </section>

        <section className="grow">
          <h2>DOCUMENTS <em>OUTPUTS · VOICE</em></h2>
          <div className="scroll">
            {briefs.length ? (
              briefs.map((b) => (
                <div className="row" key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="t">{hm(b.createdAt)}</span>
                  <Link href={`/briefs/${b.id}`} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b>{b.filePath.split("/").pop()}</b>
                  </Link>
                  <ReadAloudButton briefId={b.id} label="🔊" />
                </div>
              ))
            ) : (
              <div className="empty">Nothing shipped yet. Fire BRIEF ME and the first brief lands here as markdown.</div>
            )}
          </div>
        </section>
      </div>

      {/* ----------------------------------------------------------- centre */}
      <div className="col">
        <GraphStage
          briefCount={briefCount}
          runCount={runCount}
          completedCount={completedCount}
          projects={projects.map((p) => ({ key: p.key, name: p.name }))}
        />
      </div>

      {/* ------------------------------------------------------------ right */}
      <div className="col r">
        <section>
          <h2>COMMAND DECK <em>READ-ONLY · DRAFTS</em></h2>
          <div className="deck">
            <a className="cmd" href="/#brief">BRIEF ME</a>
            <Link className="cmd" href="/search">SEARCH VAULT</Link>
            <Link className="cmd" href="/graph">OBSIDIAN GRAPH</Link>
            <Link className="cmd" href="/register">PROJECT REGISTER</Link>
            <Link className="cmd" href="/runs">RUN LEDGER</Link>
            <Link className="cmd" href="/sources">SOURCES · GRANTS</Link>
          </div>
          <div className="note">EVERY CALL AUDITED · NOTHING SENT OR MERGED</div>
        </section>

        <section>
          <h2>RECENT RUNS <em>LEDGER</em></h2>
          <div className="scroll" style={{ maxHeight: 180 }}>
            {runs.length ? (
              runs.map((r) => (
                <div className="row" key={r.id}>
                  <span className="t">{hm(r.startedAt)}</span>{" "}
                  <span style={{ color: runColour(r.status) }}>{r.status.toUpperCase()}</span>{" "}
                  <Link href={`/runs/${r.id}`}>{r.goal.length > 44 ? r.goal.slice(0, 44) + "…" : r.goal}</Link>
                </div>
              ))
            ) : (
              <div className="empty">No runs yet.</div>
            )}
          </div>
        </section>

        <section className="grow">
          <h2>WIRE <em>AUDIT FEED</em></h2>
          <div className="scroll">
            {audits.length ? (
              audits.map((a) => (
                <div className="row" key={a.id}>
                  <span className="t">{hm(a.occurredAt)}</span>{" "}
                  <span
                    style={{
                      color:
                        a.outcome === "failed" ? "var(--hot)" :
                        a.outcome === "denied" ? "var(--warm)" : "var(--dim)",
                    }}
                  >
                    {a.eventType.replace(/_/g, " ").toUpperCase()}
                  </span>
                  {a.toolName ? ` · ${a.toolName}` : ""}
                </div>
              ))
            ) : (
              <div className="empty">Wire is quiet.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
