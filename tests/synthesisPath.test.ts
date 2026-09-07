import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs/promises";

/**
 * The synthesis path, with the model replaced.
 *
 * Everything else in the suite runs offline, so the deterministic
 * template produces every brief — and the template appends the DRAFT
 * label itself. That hides the failure this file exists for: on the
 * synthesis path the label was only ever *requested* in the prompt, so a
 * truncated or non-compliant response produced an unlabelled brief, and
 * the copy stored in the database carried no label at all.
 *
 * Removing ensureDraftLabel from the workflow passes every other test in
 * the suite. It fails here.
 */
const UNLABELLED = "# Brief\n\n## 1. Priorities\n- the model stopped mid-sen";

vi.mock("@/lib/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/models")>();
  return { ...actual, synthesize: vi.fn(async () => UNLABELLED) };
});

const { PrismaClient } = await import("@prisma/client");
const { runBriefWorkflow, DRAFT_LABEL } = await import("@/lib/brief");
const { MODEL } = await import("@/lib/models");

const prisma = new PrismaClient();
const written: string[] = [];

beforeAll(async () => {
  for (const [capability, scope] of [
    ["documents.search", { projectKeys: ["syn"] }],
    ["github.read", {}],
    ["calendar.read", {}],
    ["drafts.write", { allowedPaths: ["drafts/"] }],
  ] as const) {
    await prisma.capabilityGrant.upsert({
      where: { subject_capability: { subject: "personal-agent", capability } },
      update: { resourceScopeJson: JSON.stringify(scope), enabled: true },
      create: {
        subject: "personal-agent",
        capability,
        resourceScopeJson: JSON.stringify(scope),
        enabled: true,
      },
    });
  }

  const project = await prisma.project.upsert({
    where: { key: "syn" },
    update: {},
    create: { key: "syn", name: "Synthesis fixture" },
  });
  // One memory item is enough to make the workflow attempt synthesis:
  // it only skips when there are neither hits nor memory.
  await prisma.memoryItem.deleteMany({ where: { projectId: project.id } });
  await prisma.memoryItem.create({
    data: {
      projectId: project.id,
      kind: "project",
      category: "decision",
      statement: "A curated statement so synthesis is attempted.",
    },
  });
});

afterAll(async () => {
  for (const f of written) await fs.rm(f, { force: true });
  await prisma.$disconnect();
});

describe("synthesis path", () => {
  it("labels a model response that omitted the label", async () => {
    const r = await runBriefWorkflow({ projectKey: "syn", language: "en-CA" });
    written.push(r.filePath);

    const onDisk = await fs.readFile(r.filePath, "utf8");
    const stored = await prisma.briefDraft.findUniqueOrThrow({ where: { id: r.briefId } });

    // Prove the mock was actually used, so this is really the synthesis
    // path and not a silent fall-through to the template.
    expect(onDisk).toContain("the model stopped mid-sen");
    expect(onDisk).not.toContain("Deterministic template brief");

    expect(onDisk).toContain(DRAFT_LABEL);
    expect(stored.content).toContain(DRAFT_LABEL);
  });

  it("records the model, not the template, as the producer", async () => {
    const r = await runBriefWorkflow({ projectKey: "syn", language: "en-CA" });
    written.push(r.filePath);
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.model).toBe(MODEL);
  });
});
