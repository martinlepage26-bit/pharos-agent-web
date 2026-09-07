import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TOOL_REGISTRY, type ToolName } from "@/tools/registry";
import { CapabilityDenied } from "@/lib/policy";

const prisma = new PrismaClient();

/**
 * Every registered tool must refuse to act when its grant is revoked.
 *
 * Gating lives inside each tool rather than at a single choke point in
 * callTool, which is bypass-resistant but fragile in one specific way:
 * a new registry entry that forgets its assertCapability line would run
 * ungated while still being logged with a plausible capability string.
 * That is exactly how voice.speak escaped the authority model.
 *
 * This test iterates the registry itself, so a tool added without a gate
 * fails here the moment it is registered — no reviewer has to notice.
 */
const INPUTS: Record<ToolName, unknown> = {
  search_project_documents: { projectKey: "gate", query: "anything" },
  get_github_project_activity: { projectKey: "gate" },
  get_calendar_agenda: { projectKey: "gate" },
  create_local_brief_draft: {
    projectKey: "gate",
    language: "en-CA",
    content: "should never be written",
    slugBase: "vitest-gating",
  },
  speak_text: { text: "should never reach the voice engine" },
};

beforeAll(async () => {
  await prisma.project.upsert({
    where: { key: "gate" },
    update: {},
    create: { key: "gate", name: "Gating fixture" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("every registered tool is capability-gated", () => {
  it("covers every entry in the registry", () => {
    // Guards against a tool being added to the registry but not here.
    expect(Object.keys(INPUTS).sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
  });

  for (const name of Object.keys(TOOL_REGISTRY) as ToolName[]) {
    const spec = TOOL_REGISTRY[name];

    it(`${name} refuses to act when ${spec.capability} is revoked`, async () => {
      await prisma.capabilityGrant.upsert({
        where: {
          subject_capability: { subject: "personal-agent", capability: spec.capability },
        },
        update: { enabled: false },
        create: {
          subject: "personal-agent",
          capability: spec.capability,
          resourceScopeJson: "{}",
          enabled: false,
        },
      });

      const run = await prisma.agentRun.create({ data: { goal: `gating ${name}` } });

      // The tool function directly: the gate must be in the tool, not
      // only in the wrapper around it.
      await expect(
        (spec.run as (i: unknown, r?: string) => Promise<unknown>)(INPUTS[name], run.id)
      ).rejects.toBeInstanceOf(CapabilityDenied);

      // And the refusal is on the record with its reason.
      const denial = await prisma.auditEvent.findFirst({
        where: { runId: run.id, eventType: "capability_denied" },
        orderBy: { occurredAt: "desc" },
      });
      expect(denial).toBeTruthy();
      expect(denial!.capability).toBe(spec.capability);
      expect(denial!.purpose).toContain("disabled");
    });
  }

  it("declares no capability outside the contract's list", () => {
    // A capability appearing in code but in no grant row and no contract
    // revision is the drift §9 forbids.
    const declared = new Set(
      Object.values(TOOL_REGISTRY).map((s) => s.capability as string)
    );
    expect([...declared].sort()).toEqual([
      "calendar.read",
      "documents.search",
      "drafts.write",
      "github.read",
      "voice.speak",
    ]);
  });
});
