import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const now = new Date();
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
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Editable, expirable and deletable here — contract §4. An expired
            item stays on the record but is withheld from synthesis; deletion
            is permanent, and both are written to the audit ledger.
          </p>
          {memoryItems.length === 0 ? (
            <p className="muted">No memory items — run <code>npm run db:seed</code>.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Kind</th>
                  <th>Confidence</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {memoryItems.map((m) => {
                  // Nullish, not `=== null`: a stale generated client
                  // returns undefined for a newly added column, which
                  // silently took every row down the wrong branch.
                  const expiresAt = m.expiresAt ?? null;
                  const expired = expiresAt !== null && expiresAt <= now;
                  const scheduled = expiresAt !== null && expiresAt > now;
                  return (
                    <tr key={m.id} style={expired ? { opacity: 0.55 } : undefined}>
                      <td>
                        <form action="/api/memory" method="post" className="mem-edit">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="action" value="update" />
                          <textarea name="statement" defaultValue={m.statement} rows={3} />
                          <select name="confidence" defaultValue={m.confidence}>
                            <option value="confirmed">confirmed</option>
                            <option value="inferred">inferred</option>
                            <option value="needs_review">needs_review</option>
                          </select>
                          <button type="submit">SAVE</button>
                        </form>
                        {m.project && (
                          <div className="muted" style={{ fontSize: 11 }}>project: {m.project.key}</div>
                        )}
                        <div className="mem-actions">
                          {expiresAt === null ? (
                            <form action="/api/memory" method="post">
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="action" value="expire" />
                              <button type="submit">EXPIRE NOW</button>
                            </form>
                          ) : (
                            <form action="/api/memory" method="post">
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="action" value="restore" />
                              <button type="submit">CLEAR EXPIRY</button>
                            </form>
                          )}
                          <form action="/api/memory" method="post">
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="action" value="delete" />
                            <button type="submit" className="danger">DELETE</button>
                          </form>
                        </div>
                      </td>
                      <td><span className="badge">{m.kind}</span></td>
                      <td>
                        <span className={`badge ${m.confidence === "confirmed" ? "ok" : ""}`}>{m.confidence}</span>
                      </td>
                      <td>
                        {expired ? (
                          <span className="badge fail">expired</span>
                        ) : scheduled ? (
                          <span className="badge" title={expiresAt!.toISOString()}>
                            expires {expiresAt!.toISOString().slice(0, 10)}
                          </span>
                        ) : (
                          <span className="badge ok">active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
