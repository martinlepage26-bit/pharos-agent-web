import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await prisma.agentRun.findUnique({
    where: { id },
    include: {
      toolCalls: { orderBy: { createdAt: "asc" } },
      audits: { orderBy: { occurredAt: "asc" } },
      briefs: true,
    },
  });
  if (!run) notFound();

  return (
    <main>
      <div className="card">
        <h2>Run {run.id.slice(0, 12)}…</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Goal: {run.goal} · Language <span className="badge">{run.language}</span> ·
          Status <span className={`badge ${run.status === "completed" ? "ok" : run.status === "failed" ? "fail" : "run"}`}>{run.status}</span>
        </p>
        {run.briefs[0] && (
          <p className="mt">
            <a href={`/briefs/${run.briefs[0].id}`}>→ View the brief produced by this run</a>
          </p>
        )}
      </div>

      <div className="card mt">
        <h2>Tool calls</h2>
        {run.toolCalls.length === 0 ? (
          <p className="muted">No tool calls.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Capability</th>
                <th>Purpose</th>
                <th>Input</th>
                <th>Output</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {run.toolCalls.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.toolName}</td>
                  <td><span className="badge">{t.capability}</span></td>
                  <td className="muted">{t.purpose}</td>
                  <td className="mono" style={{ fontSize: 11, maxWidth: 220, wordBreak: "break-all" }}>
                    {t.inputJson.slice(0, 140)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{t.outputSummary}</td>
                  <td>
                    <span className={`badge ${t.status === "success" ? "ok" : t.status === "denied" ? "fail" : ""}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card mt">
        <h2>Audit ledger</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Actor</th>
              <th>Tool / capability</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {run.audits.map((a) => (
              <tr key={a.id}>
                <td className="muted" style={{ fontSize: 12 }}>
                  {new Date(a.occurredAt).toLocaleTimeString("fr-CA")}
                </td>
                <td className="mono">{a.eventType}</td>
                <td><span className="badge">{a.actor}</span></td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {a.toolName ?? a.capability ?? "—"}
                </td>
                <td>
                  {a.outcome && (
                    <span className={`badge ${a.outcome === "success" ? "ok" : a.outcome === "denied" || a.outcome === "failed" ? "fail" : ""}`}>
                      {a.outcome}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
