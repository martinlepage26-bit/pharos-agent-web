import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ReadAloudButton from "@/components/ReadAloudButton";

export const dynamic = "force-dynamic";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brief = await prisma.briefDraft.findUnique({
    where: { id },
    include: {
      run: { include: { toolCalls: true } },
    },
  });
  if (!brief) notFound();

  const toolCalls = brief.run.toolCalls;

  return (
    <main>
      <div className="card">
        <h2>Brief — {new Date(brief.createdAt).toLocaleString("fr-CA")}</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Language <span className="badge">{brief.language}</span> · Run{" "}
          <a href={`/runs/${brief.run.id}`} className="mono">{brief.run.id.slice(0, 8)}</a> ·
          Model <span className="mono">{brief.run.model ?? "template"}</span> ·
          File <span className="path">{brief.filePath}</span>
        </p>
        <p className="muted mt" style={{ fontSize: 13 }}>
          sha256 <span className="mono">{brief.contentHash.slice(0, 16)}…</span>
        </p>
        <p className="mt" style={{ fontSize: 13 }}>
          <ReadAloudButton briefId={brief.id} />
        </p>
      </div>

      <div className="mt">
        <pre className="brief">{brief.content}</pre>
      </div>

      <div className="card mt">
        <h2>Tool calls behind this brief</h2>
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Capability</th>
              <th>Purpose</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {toolCalls.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.toolName}</td>
                <td><span className="badge">{t.capability}</span></td>
                <td className="muted">{t.purpose}</td>
                <td>
                  <span className={`badge ${t.status === "success" ? "ok" : t.status === "denied" ? "fail" : ""}`}>
                    {t.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
