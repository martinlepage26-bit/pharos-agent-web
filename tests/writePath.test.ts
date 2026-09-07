import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createLocalBriefDraft } from "@/tools/createLocalBriefDraft";
import { DRAFTS_DIR, REPO_ROOT } from "@/lib/models";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const written: string[] = [];

beforeAll(async () => {
  await prisma.capabilityGrant.upsert({
    where: { subject_capability: { subject: "personal-agent", capability: "drafts.write" } },
    update: { resourceScopeJson: JSON.stringify({ allowedPaths: ["drafts/"] }), enabled: true },
    create: {
      subject: "personal-agent",
      capability: "drafts.write",
      resourceScopeJson: JSON.stringify({ allowedPaths: ["drafts/"] }),
      enabled: true,
    },
  });
});

afterAll(async () => {
  // Only remove files this suite created, never the real drafts.
  for (const f of written) await fs.rm(f, { force: true });
  await prisma.$disconnect();
});

describe("draft write path is confined to drafts/", () => {
  it("anchors DRAFTS_DIR to the repo, independent of the working directory", () => {
    expect(REPO_ROOT).toBe(path.resolve(__dirname, ".."));
    expect(DRAFTS_DIR).toBe(path.join(REPO_ROOT, "drafts"));
  });

  it("flattens hostile language values instead of escaping", async () => {
    // Each of these previously produced a file outside the repository.
    for (const language of [
      "../../../../tmp/pwned",
      "../../../.zshenv",
      "fr-CA/../../../../../../tmp/pwned2",
      "..%2F..%2Ftmp%2Fpwned3",
    ]) {
      const out = await createLocalBriefDraft({
        projectKey: "pharos",
        language,
        content: "probe",
        slugBase: "vitest-probe",
      });
      written.push(out.filePath);

      expect(out.filePath.startsWith(DRAFTS_DIR + path.sep)).toBe(true);
      expect(path.dirname(out.filePath)).toBe(DRAFTS_DIR);
      await expect(fs.access(out.filePath)).resolves.toBeUndefined();
    }

    // Nothing landed at any of the intended escape targets.
    for (const escaped of ["/tmp/pwned.md", "/tmp/pwned2.md", "/tmp/pwned3.md"]) {
      await expect(fs.access(escaped)).rejects.toThrow();
    }
  });

  it("hashes exactly the bytes it wrote", async () => {
    const out = await createLocalBriefDraft({
      projectKey: "pharos",
      language: "en-CA",
      content: "hash check",
      slugBase: "vitest-hash",
    });
    written.push(out.filePath);
    const onDisk = await fs.readFile(out.filePath, "utf8");
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(onDisk).digest("hex")).toBe(out.contentHash);
    expect(Buffer.byteLength(onDisk)).toBe(out.bytes);
  });

  it("refuses to write when the grant is revoked", async () => {
    await prisma.capabilityGrant.update({
      where: { subject_capability: { subject: "personal-agent", capability: "drafts.write" } },
      data: { enabled: false },
    });
    await expect(
      createLocalBriefDraft({
        projectKey: "pharos",
        language: "en-CA",
        content: "should not exist",
        slugBase: "vitest-revoked",
      })
    ).rejects.toThrow(/Capability denied/);

    const stray = path.join(DRAFTS_DIR, `${new Date().toISOString().slice(0, 10)}-vitest-revoked-en-CA.md`);
    await expect(fs.access(stray)).rejects.toThrow();

    await prisma.capabilityGrant.update({
      where: { subject_capability: { subject: "personal-agent", capability: "drafts.write" } },
      data: { enabled: true },
    });
  });
});

describe("audit ledger is append-only in the database", () => {
  it("accepts inserts", async () => {
    const row = await prisma.auditEvent.create({
      data: { eventType: "run_started", actor: "system", purpose: "vitest insert" },
    });
    expect(row.id).toBeTruthy();
  });

  it("rejects update, delete and truncate", async () => {
    const row = await prisma.auditEvent.findFirst();
    expect(row).toBeTruthy();

    await expect(
      prisma.auditEvent.update({ where: { id: row!.id }, data: { outcome: "tampered" } })
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.auditEvent.delete({ where: { id: row!.id } })
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.$executeRawUnsafe('TRUNCATE "AuditEvent";')
    ).rejects.toThrow(/append-only/);
  });

  it("blocks deleting a run, because that would rewrite its audit rows", async () => {
    // AuditEvent.runId is SetNull on delete, which is an UPDATE.
    const run = await prisma.agentRun.create({ data: { goal: "vitest run" } });
    await prisma.auditEvent.create({
      data: { runId: run.id, eventType: "run_started", actor: "system" },
    });
    await expect(prisma.agentRun.delete({ where: { id: run.id } })).rejects.toThrow(/append-only/);
  });
});
