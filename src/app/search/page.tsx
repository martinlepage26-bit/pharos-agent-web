import { prisma } from "@/lib/prisma";
import { searchProjectDocuments } from "@/tools/searchProjectDocuments";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; project?: string }>;
}) {
  const params = await searchParams;
  const projects = await prisma.project.findMany({ orderBy: { key: "asc" } });
  const q = params.q?.trim() ?? "";
  const projectKey = params.project ?? projects[0]?.key ?? "";
  const active = projects.find((p) => p.key === projectKey) ?? projects[0];
  const results = q && active ? await searchProjectDocuments({
    projectKey: active.key,
    query: q,
    limit: 12,
  }) : null;

  return (
    <main>
      <div className="card">
        <h2>Search registered sources</h2>
        <form className="brief-form" method="get">
          <select name="project" defaultValue={active?.key ?? ""}>
            {projects.map((p) => (
              <option key={p.id} value={p.key}>{p.name}</option>
            ))}
          </select>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="decision, risk, milestone…"
            style={{
              flex: 1, minWidth: 240, background: "var(--panel-2)",
              border: "1px solid var(--border)", borderRadius: 8,
              padding: "9px 14px", color: "var(--text)", fontSize: 14,
            }}
          />
          <button className="primary" type="submit">Search</button>
        </form>
      </div>

      {results && (
        <div className="card mt">
          <h2>{results.total} result(s)</h2>
          {results.hits.map((h) => (
            <div key={h.chunkId} style={{ marginBottom: 18 }}>
              <div>
                <strong>{h.heading ?? h.documentTitle ?? h.documentPath}</strong>{" "}
                <span className="badge">{h.sourceLabel}</span>
              </div>
              <div className="path">{h.documentPath}</div>
              <div className="excerpt">{h.excerpt}</div>
            </div>
          ))}
          {results.total === 0 && (
            <p className="muted">
              Nothing found. Run <code>npm run ingest</code> to index registered folders.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
