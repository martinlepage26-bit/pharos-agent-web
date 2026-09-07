import { prisma } from "@/lib/prisma";
import { DRAFT_LABEL } from "@/lib/brief";

export const dynamic = "force-dynamic";

/**
 * Briefs index. Individual briefs existed at /briefs/[id] but were
 * reachable only from the dashboard's document list or a run page — there
 * was no way to see what the agent had written over time.
 */
export default async function BriefsPage() {
  const briefs = await prisma.briefDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { run: true },
  });

  return (
    <main>
      <div className="card">
        <h2>Brief drafts</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Every brief is a draft requiring human review. The label is written
          by the workflow, not requested from the model.
        </p>
        {briefs.length === 0 ? (
          <p className="muted">
            No briefs yet — run <code>npm run brief -- --project pharos</code>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Draft</th>
                <th>Language</th>
                <th>Produced by</th>
                <th>Labelled</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.id}>
                  <td>
                    <a href={`/briefs/${b.id}`}>{b.filePath.split("/").pop()}</a>
                    <div className="muted" style={{ fontSize: 11 }}>
                      <a href={`/runs/${b.runId}`}>run {b.runId.slice(0, 8)}</a>
                      {" · "}
                      {b.contentHash.slice(0, 12)}
                    </div>
                  </td>
                  <td><span className="badge">{b.language}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {b.run.model ?? "—"}
                  </td>
                  <td>
                    {b.content.includes(DRAFT_LABEL) ? (
                      <span className="badge ok">draft</span>
                    ) : (
                      <span className="badge fail">unlabelled</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {new Date(b.createdAt).toLocaleString("fr-CA")}
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
