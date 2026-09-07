import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await prisma.agentRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { toolCalls: true, _count: { select: { audits: true } } },
  });

  return (
    <main>
      <div className="card">
        <h2>Agent runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No runs recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Goal</th>
                <th>Status</th>
                <th>Tool calls</th>
                <th>Audit events</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/runs/${r.id}`}>{r.goal}</a>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.model ?? "template"}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${r.status === "completed" ? "ok" : r.status === "failed" ? "fail" : "run"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="mono">{r.toolCalls.length}</td>
                  <td className="mono">{r._count.audits}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {new Date(r.startedAt).toLocaleString("fr-CA")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
