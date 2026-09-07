import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { searchProjectDocuments } from "@/tools/searchProjectDocuments";
import { runBriefWorkflow, DRAFT_LABEL } from "@/lib/brief";
import { DRAFTS_DIR } from "@/lib/models";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const written: string[] = [];

const CHUNKS = [
  { heading: "Decisions locked", content: "The routing decision was taken in June and stands." },
  { heading: "Priorities", content: "Ship the ingest rewrite before the roadmap review." },
  { heading: "Open risks", content: "A blocker remains on the calendar adapter." },
  { heading: "Notes", content: "Nothing consequential happened this week at all." },
  {
    heading: "Long section",
    // Retrievable by the workflow's "milestone delivery next steps"
    // query, with the risk keyword pushed past the 600-character excerpt
    // cut: filtering on `excerpt` misses it, filtering on `content`
    // finds it.
    content:
      "Roadmap milestone delivery next steps. " +
      "x".repeat(700) +
      " a late-mentioned risk appears here.",
  },
];

beforeAll(async () => {
  await prisma.capabilityGrant.upsert({
    where: { subject_capability: { subject: "personal-agent", capability: "documents.search" } },
    update: { resourceScopeJson: JSON.stringify({ projectKeys: ["t"] }), enabled: true },
    create: {
      subject: "personal-agent",
      capability: "documents.search",
      resourceScopeJson: JSON.stringify({ projectKeys: ["t"] }),
      enabled: true,
    },
  });
  for (const c of ["github.read", "calendar.read", "drafts.write"]) {
    await prisma.capabilityGrant.upsert({
      where: { subject_capability: { subject: "personal-agent", capability: c } },
      update: {
        enabled: true,
        resourceScopeJson: c === "drafts.write"
          ? JSON.stringify({ allowedPaths: ["drafts/"] })
          : JSON.stringify({}),
      },
      create: {
        subject: "personal-agent",
        capability: c,
        enabled: true,
        resourceScopeJson: c === "drafts.write"
          ? JSON.stringify({ allowedPaths: ["drafts/"] })
          : JSON.stringify({}),
      },
    });
  }

  const project = await prisma.project.upsert({
    where: { key: "t" },
    update: {},
    create: { key: "t", name: "Test project" },
  });
  const source = await prisma.source.upsert({
    where: { id: "t-src" },
    update: {},
    create: {
      id: "t-src",
      projectId: project.id,
      kind: "local_folder",
      label: "test docs",
      rootPath: "/nonexistent",
      enabled: true,
    },
  });
  const doc = await prisma.document.upsert({
    where: { sourceId_path: { sourceId: source.id, path: "notes.md" } },
    update: {},
    create: { sourceId: source.id, path: "notes.md", title: "Notes", contentHash: "h" },
  });
  await prisma.chunk.deleteMany({ where: { documentId: doc.id } });
  await prisma.chunk.createMany({
    data: CHUNKS.map((c, i) => ({ documentId: doc.id, ordinal: i, heading: c.heading, content: c.content })),
  });
});

afterAll(async () => {
  for (const f of written) await fs.rm(f, { force: true });
  await prisma.$disconnect();
});

describe("retrieval query semantics", () => {
  it("matches on ANY term, not all of them", async () => {
    // plainto_tsquery ANDs its words, so this exact query — one of the
    // three the brief workflow issues — matched nothing at all, and every
    // brief was built on zero evidence.
    const out = await searchProjectDocuments({ projectKey: "t", query: "decision priority roadmap" });
    expect(out.total).toBeGreaterThan(0);
  });

  it("ranks a chunk matching more terms above one matching fewer", async () => {
    const out = await searchProjectDocuments({ projectKey: "t", query: "decision routing" });
    expect(out.hits[0].content).toContain("routing decision");
  });

  it("returns nothing for a query with no usable words", async () => {
    expect((await searchProjectDocuments({ projectKey: "t", query: "   " })).total).toBe(0);
    expect((await searchProjectDocuments({ projectKey: "t", query: "!!! &|" })).total).toBe(0);
  });

  it("survives operator characters that would break to_tsquery", async () => {
    await expect(
      searchProjectDocuments({ projectKey: "t", query: "risk & (blocker | ')" })
    ).resolves.toBeTruthy();
  });

  it("clamps limit, including values that are not numbers", async () => {
    const total = async (limit: unknown) =>
      (await searchProjectDocuments({ projectKey: "t", query: "the", limit: limit as number })).hits.length;
    // A non-numeric limit made the clamp NaN and the query unbounded.
    expect(await total("not-a-number")).toBeLessThanOrEqual(8);
    expect(await total(999)).toBeLessThanOrEqual(25);
    expect(await total(0)).toBe(1);
    expect(await total(-5)).toBe(1);
    expect(await total(2)).toBe(2);
  });

  it("carries full chunk content alongside the truncated excerpt", async () => {
    const out = await searchProjectDocuments({ projectKey: "t", query: "milestone" });
    const long = out.hits.find((h) => h.heading === "Long section");
    expect(long).toBeTruthy();
    expect(long!.excerpt.length).toBeLessThan(long!.content.length);
    expect(long!.excerpt).not.toContain("risk");
    expect(long!.content).toContain("risk");
  });
});

describe("brief workflow", () => {
  it("populates decision and risk sections from retrieved evidence", async () => {
    const r = await runBriefWorkflow({ projectKey: "t", language: "en-CA" });
    written.push(r.filePath);
    const brief = await fs.readFile(r.filePath, "utf8");

    // Both sections read "no evidence retrieved" on every brief ever
    // produced, because the filter tested a field SearchHit did not have.
    expect(brief).not.toContain("No decision-tagged evidence retrieved");
    expect(brief).not.toContain("No risk-tagged evidence retrieved");
    expect(brief).toContain("routing decision");
  });

  it("finds a keyword that sits past the excerpt cut", async () => {
    const r = await runBriefWorkflow({ projectKey: "t", language: "en-CA" });
    written.push(r.filePath);
    const brief = await fs.readFile(r.filePath, "utf8");
    expect(brief).toContain("Long section");
  });

  it("labels every brief, and writes it inside drafts/", async () => {
    const r = await runBriefWorkflow({ projectKey: "t", language: "en-CA" });
    written.push(r.filePath);
    expect(r.filePath.startsWith(DRAFTS_DIR + path.sep)).toBe(true);

    const stored = await prisma.briefDraft.findUnique({ where: { id: r.briefId } });
    // The stored copy is what the UI renders; it used to carry no label.
    expect(stored!.content).toContain(DRAFT_LABEL);
    expect(await fs.readFile(r.filePath, "utf8")).toContain(DRAFT_LABEL);
  });

  it("records the deterministic template as the producer when offline", async () => {
    const r = await runBriefWorkflow({ projectKey: "t", language: "en-CA" });
    written.push(r.filePath);
    const run = await prisma.agentRun.findUnique({ where: { id: r.runId } });
    // No key is configured for the suite, so synthesis never runs.
    expect(run!.model).toBe("deterministic-template");
    expect(run!.status).toBe("completed");
  });

  it("withholds expired memory from synthesis", async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { key: "t" } });
    await prisma.memoryItem.deleteMany({ where: { projectId: project.id } });
    await prisma.memoryItem.create({
      data: {
        projectId: project.id,
        kind: "project",
        category: "decision",
        statement: "LIVE-MEMORY-MARKER stays in the brief.",
      },
    });
    await prisma.memoryItem.create({
      data: {
        projectId: project.id,
        kind: "project",
        category: "decision",
        statement: "EXPIRED-MEMORY-MARKER must not appear.",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const r = await runBriefWorkflow({ projectKey: "t", language: "en-CA" });
    written.push(r.filePath);
    const brief = await fs.readFile(r.filePath, "utf8");
    expect(brief).toContain("LIVE-MEMORY-MARKER");
    expect(brief).not.toContain("EXPIRED-MEMORY-MARKER");
  });
});
