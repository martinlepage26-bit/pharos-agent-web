/**
 * Seed: registers the initial governed surface area of the agent.
 * - Projects: pharos (the personal OS) and pharos-suite.
 * - Sources: local folders only (no GitHub/calendar yet — honest stubs).
 * - Capability grants: read tools preapproved and narrowly scoped;
 *   drafts.write confined to this repo's drafts/ directory.
 * - Curated profile + project memory with provenance.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HOME = process.env.HOME ?? "/Users/pharos_ai";

async function main() {
  const pharos = await prisma.project.upsert({
    where: { key: "pharos" },
    update: {},
    create: {
      key: "pharos",
      name: "PHAROS — Personal OS",
      description:
        "Voice-routed personal operating system: skills, runner, HUD, vault, governance.",
    },
  });

  const suite = await prisma.project.upsert({
    where: { key: "pharos-suite" },
    update: {},
    create: {
      key: "pharos-suite",
      name: "PHAROS Suite",
      description: "Containerized suite build (Dockerfiles, email infra, CRM).",
    },
  });

  await prisma.source.upsert({
    where: { id: "src-pharos-local" },
    update: { enabled: true },
    create: {
      id: "src-pharos-local",
      projectId: pharos.id,
      kind: "local_folder",
      label: "~/pharos docs",
      rootPath: `${HOME}/pharos`,
      enabled: true,
    },
  });

  await prisma.source.upsert({
    where: { id: "src-suite-local" },
    update: { enabled: true },
    create: {
      id: "src-suite-local",
      projectId: suite.id,
      kind: "local_folder",
      label: "~/pharos-suite docs",
      rootPath: `${HOME}/pharos-suite`,
      enabled: true,
    },
  });

  const grants: Array<{
    capability: string;
    resourceScopeJson: string;
    approvalMode: string;
  }> = [
    {
      capability: "documents.search",
      resourceScopeJson: JSON.stringify({ projectKeys: ["pharos", "pharos-suite"] }),
      approvalMode: "preapproved",
    },
    {
      // An empty allowlist denies every repository. Registering a
      // github_repo source is not enough on its own — add its full name
      // here too. The tool reports what it was refused rather than
      // returning a short list that looks like "no activity".
      capability: "github.read",
      resourceScopeJson: JSON.stringify({ repositoryIds: [] }),
      approvalMode: "preapproved",
    },
    {
      capability: "calendar.read",
      resourceScopeJson: JSON.stringify({ projectKeys: ["pharos", "pharos-suite"] }),
      approvalMode: "preapproved",
    },
    {
      capability: "drafts.write",
      resourceScopeJson: JSON.stringify({
        allowedPaths: ["drafts/"],
      }),
      approvalMode: "preapproved",
    },
    {
      // No project/repo/path dimension applies: the tool sends text to the
      // local engine on loopback and reads nothing beyond the brief it was
      // handed. The grant row itself is the control — disable it to revoke.
      capability: "voice.speak",
      resourceScopeJson: JSON.stringify({}),
      approvalMode: "preapproved",
    },
  ];

  for (const g of grants) {
    await prisma.capabilityGrant.upsert({
      where: { subject_capability: { subject: "personal-agent", capability: g.capability } },
      update: { ...g, enabled: true },
      create: { subject: "personal-agent", ...g, enabled: true },
    });
  }

  const memory: Array<{
    projectId: string | null;
    kind: string;
    category: string;
    statement: string;
    sourceRefs: string[];
    confidence: string;
  }> = [
    {
      projectId: null,
      kind: "profile",
      category: "preference",
      statement:
        "Preferred output language: Canadian French first, with co-equal English-Canadian equivalents when requested.",
      sourceRefs: ["seed: user profile, 2026-09-04"],
      confidence: "confirmed",
    },
    {
      projectId: null,
      kind: "profile",
      category: "preference",
      statement:
        "Governance expectations: human review before consequential action; traceable provenance; explicit uncertainty.",
      sourceRefs: ["seed: PHAROS-AGENT-CONTRACT.md"],
      confidence: "confirmed",
    },
    {
      projectId: pharos.id,
      kind: "project",
      category: "architecture",
      statement:
        "PHAROS routes utterances through skills with policy gates; state lives in ~/pharos/state (queue.jsonl, schedule.json, graph.json).",
      sourceRefs: ["~/pharos/README.md"],
      confidence: "confirmed",
    },
    {
      projectId: pharos.id,
      kind: "project",
      category: "requirement",
      statement:
        "The normative agent contract lives in the companion repository pharos-agent (this repo), docs/PHAROS-AGENT-CONTRACT.md.",
      sourceRefs: ["~/pharos/README.md"],
      confidence: "confirmed",
    },
  ];

  for (const m of memory) {
    const existing = await prisma.memoryItem.findFirst({
      where: { statement: m.statement },
    });
    if (!existing) {
      await prisma.memoryItem.create({
        data: { ...m, sourceRefs: JSON.stringify(m.sourceRefs) },
      });
    }
  }

  console.log(
    `Seed complete: 2 projects, 2 local sources, ${grants.length} capability grants, memory items.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
