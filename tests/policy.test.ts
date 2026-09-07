import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertCapability, CapabilityDenied } from "@/lib/policy";
import { DRAFTS_DIR } from "@/lib/models";
import path from "node:path";

const prisma = new PrismaClient();

async function grant(capability: string, scope: object, enabled = true, expiresAt?: Date) {
  await prisma.capabilityGrant.upsert({
    where: { subject_capability: { subject: "personal-agent", capability } },
    update: { resourceScopeJson: JSON.stringify(scope), enabled, expiresAt: expiresAt ?? null },
    create: {
      subject: "personal-agent",
      capability,
      resourceScopeJson: JSON.stringify(scope),
      enabled,
      expiresAt: expiresAt ?? null,
    },
  });
}

const denied = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(CapabilityDenied);

beforeEach(async () => {
  await prisma.capabilityGrant.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("grant validity", () => {
  it("denies when no grant row exists at all", async () => {
    await denied(assertCapability("documents.search", { projectKey: "pharos" }));
  });

  it("denies a disabled grant", async () => {
    await grant("documents.search", { projectKeys: ["pharos"] }, false);
    await denied(assertCapability("documents.search", { projectKey: "pharos" }));
  });

  it("denies an expired grant", async () => {
    await grant("documents.search", { projectKeys: ["pharos"] }, true, new Date(Date.now() - 1000));
    await denied(assertCapability("documents.search", { projectKey: "pharos" }));
  });

  it("allows an unexpired, enabled, in-scope grant", async () => {
    await grant("documents.search", { projectKeys: ["pharos"] });
    await expect(
      assertCapability("documents.search", { projectKey: "pharos" })
    ).resolves.toBeUndefined();
  });
});

describe("scope enforcement fails closed", () => {
  it("denies a project outside the allowlist", async () => {
    await grant("documents.search", { projectKeys: ["pharos"] });
    await denied(assertCapability("documents.search", { projectKey: "something-else" }));
  });

  it("denies when the grant declares projects and the caller names none", async () => {
    // This is the fail-open hole: omitting the field used to skip the
    // check entirely, so a declared scope looked enforced but was not.
    await grant("documents.search", { projectKeys: ["pharos"] });
    await denied(assertCapability("documents.search", {}));
  });

  it("denies when the grant declares paths and the caller names none", async () => {
    await grant("drafts.write", { allowedPaths: ["drafts/"] });
    await denied(assertCapability("drafts.write", { projectKey: "pharos" }));
  });
});

describe("path scope", () => {
  beforeEach(async () => {
    await grant("drafts.write", { allowedPaths: ["drafts/"] });
  });

  it("allows a file inside drafts/", async () => {
    await expect(
      assertCapability("drafts.write", { path: path.join(DRAFTS_DIR, "a.md") })
    ).resolves.toBeUndefined();
  });

  it("denies a file outside drafts/, including a sibling with the same prefix", async () => {
    for (const p of [
      "/tmp/pwned.md",
      path.join(path.dirname(DRAFTS_DIR), "evil.md"),
      `${DRAFTS_DIR}-not-really/a.md`,
      "/Users/pharos_ai/.zshenv",
    ]) {
      await denied(assertCapability("drafts.write", { path: p }));
    }
  });

  it("resolves allowedPaths against the repo root, not the working directory", async () => {
    // The original bug: both sides resolved against process.cwd(), so
    // they moved together and the comparison could never fail.
    const cwd = process.cwd();
    try {
      process.chdir("/tmp");
      await expect(
        assertCapability("drafts.write", { path: path.join(DRAFTS_DIR, "a.md") })
      ).resolves.toBeUndefined();
      await denied(assertCapability("drafts.write", { path: "/tmp/drafts/a.md" }));
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("repository scope is per-access", () => {
  it("lets the project-level entry check through while an allowlist exists", async () => {
    // Demanding a repositoryId here would deny the GitHub tool outright
    // the moment the allowlist were populated.
    await grant("github.read", { repositoryIds: ["owner/allowed"] });
    await expect(
      assertCapability("github.read", { projectKey: "pharos" })
    ).resolves.toBeUndefined();
  });

  it("allows a listed repository and denies an unlisted one", async () => {
    await grant("github.read", { repositoryIds: ["owner/allowed"] });
    await expect(
      assertCapability("github.read", { repositoryId: "owner/allowed" })
    ).resolves.toBeUndefined();
    await denied(assertCapability("github.read", { repositoryId: "owner/blocked" }));
  });

  it("treats an empty allowlist as deny-all, not allow-all", async () => {
    await grant("github.read", { repositoryIds: [] });
    await denied(assertCapability("github.read", { repositoryId: "owner/anything" }));
  });
});

describe("denials reach the ledger", () => {
  it("records a capability_denied carrying the reason, before throwing", async () => {
    await grant("documents.search", { projectKeys: ["pharos"] }, false);
    const before = await prisma.auditEvent.count({ where: { eventType: "capability_denied" } });
    await denied(assertCapability("documents.search", { projectKey: "pharos" }));
    const rows = await prisma.auditEvent.findMany({
      where: { eventType: "capability_denied" },
      orderBy: { occurredAt: "desc" },
      take: 1,
    });
    expect(await prisma.auditEvent.count({ where: { eventType: "capability_denied" } })).toBe(before + 1);
    expect(rows[0].purpose).toContain("disabled");
    expect(rows[0].outcome).toBe("denied");
  });
});
