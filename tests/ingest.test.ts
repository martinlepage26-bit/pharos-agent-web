import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const REPO = path.resolve(__dirname, "..");

let dir = "";
let sourceId = "";

function ingest(force = false) {
  execFileSync(
    path.join(REPO, "node_modules/.bin/tsx"),
    [path.join(REPO, "scripts/ingest.ts"), ...(force ? ["--force"] : [])],
    { cwd: REPO, env: { ...process.env }, stdio: "pipe" }
  );
}

async function write(body: string) {
  await fs.writeFile(path.join(dir, "doc.md"), body, "utf8");
}

async function chunkTexts(): Promise<string[]> {
  const rows = await prisma.chunk.findMany({
    where: { document: { sourceId } },
    orderBy: { ordinal: "asc" },
  });
  return rows.map((r) => r.content);
}

const doc = (marker: string) => `# Doc

## Alpha
${marker} alpha body, comfortably longer than the forty character minimum.

## Beta
${marker} beta body, comfortably longer than the forty character minimum.
`;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pharos-ingest-"));
  const project = await prisma.project.upsert({
    where: { key: "ing" },
    update: {},
    create: { key: "ing", name: "Ingest fixture" },
  });
  const source = await prisma.source.create({
    data: {
      projectId: project.id,
      kind: "local_folder",
      label: "ingest fixture",
      rootPath: dir,
      enabled: true,
    },
  });
  sourceId = source.id;
});

afterAll(async () => {
  await prisma.source.deleteMany({ where: { id: sourceId } });
  await fs.rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("ingestion freshness", () => {
  it("indexes a new document", async () => {
    await write(doc("ORIGINAL"));
    ingest();
    const texts = await chunkTexts();
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => t.includes("ORIGINAL"))).toBe(true);
  });

  it("re-indexes an edit that leaves the chunk count unchanged", async () => {
    // The bug: the change test compared the hash the upsert had just
    // written against itself, so only a changed chunk count triggered a
    // rebuild. Edited prose stayed stale in the index indefinitely while
    // the row claimed to be current.
    await write(doc("REVISED"));
    ingest();
    const texts = await chunkTexts();
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => t.includes("REVISED"))).toBe(true);
    expect(texts.some((t) => t.includes("ORIGINAL"))).toBe(false);
  });

  it("does not rewrite chunks when nothing changed", async () => {
    const before = await prisma.chunk.findMany({
      where: { document: { sourceId } },
      orderBy: { ordinal: "asc" },
      select: { id: true },
    });
    ingest();
    const after = await prisma.chunk.findMany({
      where: { document: { sourceId } },
      orderBy: { ordinal: "asc" },
      select: { id: true },
    });
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
  });

  it("advances the stored hash only when the chunks are actually rebuilt", async () => {
    // Otherwise an interrupted run leaves the row claiming a freshness
    // the chunks do not have, and no later incremental run can detect it.
    await write(doc("THIRD"));
    ingest();
    const d = await prisma.document.findFirstOrThrow({ where: { sourceId } });
    const { createHash } = await import("node:crypto");
    const onDisk = await fs.readFile(path.join(dir, "doc.md"), "utf8");
    expect(d.contentHash).toBe(createHash("sha256").update(onDisk).digest("hex"));
    expect((await chunkTexts()).every((t) => t.includes("THIRD"))).toBe(true);
  });

  it("--force rebuilds an index already corrupted by the old behaviour", async () => {
    // Simulate the damage: chunks say one thing, the hash says they are
    // current. An incremental run cannot fix this; --force exists for it.
    const d = await prisma.document.findFirstOrThrow({ where: { sourceId } });
    await prisma.chunk.updateMany({
      where: { documentId: d.id },
      data: { content: "STALE placeholder text of sufficient length to survive." },
    });

    ingest();
    expect((await chunkTexts()).some((t) => t.includes("STALE"))).toBe(true);

    ingest(true);
    const texts = await chunkTexts();
    expect(texts.some((t) => t.includes("STALE"))).toBe(false);
    expect(texts.every((t) => t.includes("THIRD"))).toBe(true);
  });

  it("reads only inside the registered root", async () => {
    const outside = path.join(os.tmpdir(), `pharos-outside-${Date.now()}.md`);
    await fs.writeFile(outside, "# Outside\n\nShould never be indexed by this source at all.\n");
    try {
      ingest(true);
      const paths = (
        await prisma.document.findMany({ where: { sourceId }, select: { path: true } })
      ).map((d) => d.path);
      expect(paths).toEqual(["doc.md"]);
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});
