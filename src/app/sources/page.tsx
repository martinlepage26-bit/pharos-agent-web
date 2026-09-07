import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [sources, grants, memoryItems] = await Promise.all([
    prisma.source.findMany({ include: { project: true, documents: true } }),
    prisma.capabilityGrant.findMany({ orderBy: { capability: "asc" } }),
    prisma.memoryItem.findMany({ include: { project: true }, orderBy: { updatedAt: "desc" } }),
  ]);

  return (
    <main>
      <div className="card">
        <h2>Registered sources</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          The agent can only retrieve from these explicitly registered sources. Nothing else on disk is indexed.
        </p>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Kind</th>
              <th>Project</th>
              <th>Scope</th>
              <th>Documents</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.label}</strong></td>
                <td><span className="badge">{s.kind}</span></td>
                <td className="muted">{s.project.key}</td>
                <td className="path">{s.rootPath ?? s.repoFullName ?? "—"}</td>
                <td className="mono">{s.documents.length}</td>
                <td>
                  <span className={`badge ${s.enabled ? "ok" : ""}`}>{s.enabled ? "yes" : "no"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid cols-2 mt">
        <div className="card">
          <h2>Capability grants</h2>
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Mode</th>
                <th>Scope</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.capability}</td>
                  <td><span className="badge">{g.approvalMode}</span></td>
                  <td className="mono" style={{ fontSize: 11 }}>{g.resourceScopeJson}</td>
                  <td>
                    <span className={`badge ${g.enabled ? "ok" : "fail"}`}>{g.enabled ? "yes" : "no"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Curated memory</h2>
          {memoryItems.length === 0 ? (
            <p className="muted">No memory items — run <code>npm run db:seed</code>.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Kind</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {memoryItems.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.statement}
                      {m.project && (
                        <div className="muted" style={{ fontSize: 11 }}>project: {m.project.key}</div>
                      )}
                    </td>
                    <td><span className="badge">{m.kind}</span></td>
                    <td>
                      <span className={`badge ${m.confidence === "confirmed" ? "ok" : ""}`}>{m.confidence}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
