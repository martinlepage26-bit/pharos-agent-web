/**
 * Ingestion: walk each enabled local_folder source, extract Markdown
 * documents, chunk them by heading, and record provenance (path, title,
 * content hash). Only registered source roots are ever read.
 *
 * Re-running is idempotent: documents are upserted by (sourceId, path)
 * and chunks are replaced when the content hash changes.
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

const MAX_FILE_BYTES = 200_000;
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "vendor",
  "tts-cache", ".build", "logs", "state", "vault",
]);
const MAX_DEPTH = 3;

type ChunkData = { ordinal: number; heading: string | null; content: string };

function chunkMarkdown(text: string): ChunkData[] {
  const lines = text.split("\n");
  const chunks: ChunkData[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content.length > 40) {
      chunks.push({ ordinal: chunks.length, heading, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim().slice(0, 120);
    }
    buffer.push(line);
    if (buffer.join("\n").length > 1400) flush();
  }
  flush();
  return chunks;
}

async function* walk(dir: string, depth = 0): AsyncGenerator<string> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        yield* walk(full, depth + 1);
      }
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      yield full;
    }
  }
}

async function main() {
  const sources = await prisma.source.findMany({
    where: { kind: "local_folder", enabled: true, rootPath: { not: null } },
    include: { project: true },
  });

  for (const source of sources) {
    if (!source.rootPath) continue;
    let docCount = 0;
    let chunkCount = 0;

    for await (const filePath of walk(source.rootPath)) {
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || stat.size > MAX_FILE_BYTES) continue;

      const raw = await fs.readFile(filePath, "utf8").catch(() => null);
      if (!raw) continue;

      const relPath = path.relative(source.rootPath, filePath);
      const contentHash = createHash("sha256").update(raw).digest("hex");

      const document = await prisma.document.upsert({
        where: { sourceId_path: { sourceId: source.id, path: relPath } },
        update: { contentHash, ingestedAt: new Date() },
        create: {
          sourceId: source.id,
          path: relPath,
          title: raw.split("\n").find((l) => l.startsWith("# "))?.slice(2).slice(0, 160) ?? relPath,
          contentHash,
        },
      });

      // Replace chunks only if content changed or chunks absent
      const existing = await prisma.chunk.count({ where: { documentId: document.id } });
      const chunks = chunkMarkdown(raw);
      if (existing !== chunks.length || document.contentHash !== contentHash) {
        await prisma.chunk.deleteMany({ where: { documentId: document.id } });
        await prisma.chunk.createMany({
          data: chunks.map((c) => ({
            documentId: document.id,
            ordinal: c.ordinal,
            heading: c.heading,
            content: c.content,
          })),
        });
      }
      docCount++;
      chunkCount += chunks.length;
    }

    await prisma.auditEvent.create({
      data: {
        eventType: "ingestion_completed",
        actor: "system",
        toolName: "ingest",
        capability: "documents.search",
        resourceRef: source.rootPath,
        purpose: `${docCount} documents, ${chunkCount} chunks`,
        outcome: "success",
      },
    });

    console.log(
      `[ingest] ${source.label}: ${docCount} documents, ${chunkCount} chunks`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
