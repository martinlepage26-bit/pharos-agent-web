import { prisma } from "../lib/prisma";
import { assertCapability } from "../lib/policy";
import { recordAudit } from "../lib/audit";

export type SearchHit = {
  chunkId: string;
  heading: string | null;
  /** Display text: the first 600 characters of the chunk. */
  excerpt: string;
  /**
   * The full chunk text, for callers that need to classify a hit rather
   * than show it. A quarter of chunks are longer than the excerpt, so
   * filtering on `excerpt` silently misses keywords past that cut.
   * Nothing outbound uses this field — the model prompt sends `excerpt`.
   */
  content: string;
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

  // Coerce before clamping. A non-numeric limit made every arithmetic
  // step NaN, the clamp evaluated to NaN, and the query ran without an
  // effective limit — a caller could ask for one row and receive the
  // whole match set.
  const requested = Number(input.limit ?? 8);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 25)
    : 8;
  const term = input.query.trim();
  if (!term) return { hits: [], total: 0 };

  // plainto_tsquery ANDs every word, so a multi-word query only matched a
  // chunk containing all of them. None of the brief workflow's three
  // queries ("decision priority roadmap", "risk blocker status",
  // "milestone delivery next steps") ever matched anything, so every brief
  // was built on zero retrieved evidence. OR the terms instead and let
  // ts_rank surface the chunks that match the most of them.
  //
  // Words are reduced to letters and digits before reaching to_tsquery,
  // which would otherwise raise a syntax error on operator characters.
  // The result is still passed as a bind parameter, not interpolated.
  const words = term.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const tsQuery = words.join(" | ");
  if (!tsQuery) return { hits: [], total: 0 };

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
    CROSS JOIN to_tsquery('english', ${tsQuery}) q
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
      content: r.content,
      documentPath: r.path,
      documentTitle: r.title,
      sourceLabel: r.sourceLabel,
      projectKey: r.projectKey,
      rank: Number(r.rank),
    })),
  };
}
