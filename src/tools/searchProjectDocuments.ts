import { prisma } from "../lib/prisma";
import { assertCapability } from "../lib/policy";
import { recordAudit } from "../lib/audit";

export type SearchHit = {
  chunkId: string;
  heading: string | null;
  excerpt: string;
  documentPath: string;
  documentTitle: string | null;
  sourceLabel: string;
  projectKey: string;
  rank: number;
};

export type SearchInput = {
  projectKey: string;
  query: string;
  limit?: number;
};

export type SearchOutput = {
  hits: SearchHit[];
  total: number;
};

/**
 * Tool: search_project_documents
 * Scope: only documents ingested from explicitly registered, enabled sources.
 * Retrieval: PostgreSQL full-text ranking (pgvector upgrade path documented
 * in db/extensions.sql).
 */
export async function searchProjectDocuments(
  input: SearchInput,
  runId?: string
): Promise<SearchOutput> {
  await assertCapability("documents.search", { projectKey: input.projectKey }, runId);

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const term = input.query.trim();
  if (!term) return { hits: [], total: 0 };

  const rows: Array<{
    id: string;
    heading: string | null;
    content: string;
    rank: number;
    path: string;
    title: string | null;
    sourceLabel: string;
    projectKey: string;
  }> = await prisma.$queryRaw`
    SELECT c.id, c.heading, c.content,
           GREATEST(
             ts_rank(to_tsvector('english', c.content), q),
             CASE WHEN c.content ILIKE ${"%" + term + "%"} THEN 0.05 ELSE 0 END
           ) AS rank,
           d.path, d.title, s.label AS "sourceLabel", p.key AS "projectKey"
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    JOIN "Source" s ON s.id = d."sourceId"
    JOIN "Project" p ON p.id = s."projectId"
    CROSS JOIN plainto_tsquery('english', ${term}) q
    WHERE s.enabled = true
      AND p.key = ${input.projectKey}
      AND (
        to_tsvector('english', c.content) @@ q
        OR c.content ILIKE ${"%" + term + "%"}
        OR d.path ILIKE ${"%" + term + "%"}
      )
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  await recordAudit({
    runId,
    eventType: "retrieval_completed",
    actor: "agent",
    toolName: "search_project_documents",
    capability: "documents.search",
    resourceRef: input.projectKey,
    purpose: `query: ${term}`,
    outcome: "success",
  });

  return {
    total: rows.length,
    hits: rows.map((r) => ({
      chunkId: r.id,
      heading: r.heading,
      excerpt: r.content.length > 600 ? r.content.slice(0, 600) + "…" : r.content,
      documentPath: r.path,
      documentTitle: r.title,
      sourceLabel: r.sourceLabel,
      projectKey: r.projectKey,
      rank: Number(r.rank),
    })),
  };
}
