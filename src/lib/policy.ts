import path from "node:path";
import { prisma } from "./prisma";
import { recordAudit } from "./audit";

export type Capability =
  | "documents.search"
  | "github.read"
  | "calendar.read"
  | "drafts.write";

type Scope = {
  projectKeys?: string[];
  repositoryIds?: string[];
  allowedPaths?: string[];
};

export class CapabilityDenied extends Error {
  capability: string;
  constructor(capability: string, reason: string) {
    super(`Capability denied: ${capability} — ${reason}`);
    this.capability = capability;
  }
}

/**
 * Authorization is application data, not prompt wording.
 * Before every tool call the engine verifies an explicit, enabled,
 * unexpired CapabilityGrant whose scope covers the requested resource.
 */
export async function assertCapability(
  capability: Capability,
  resource: { projectKey?: string; repositoryId?: string; path?: string } = {},
  runId?: string
): Promise<void> {
  const grant = await prisma.capabilityGrant.findUnique({
    where: { subject_capability: { subject: "personal-agent", capability } },
  });

  const deny = async (reason: string) => {
    await recordAudit({
      runId,
      eventType: "capability_denied",
      actor: "system",
      capability,
      purpose: reason,
      outcome: "denied",
    });
    throw new CapabilityDenied(capability, reason);
  };

  if (!grant) return deny("no grant exists");
  if (!grant.enabled) return deny("grant is disabled");
  if (grant.expiresAt && grant.expiresAt < new Date())
    return deny("grant has expired");

  const scope: Scope = JSON.parse(grant.resourceScopeJson || "{}");
  if (scope.projectKeys?.length && resource.projectKey) {
    if (!scope.projectKeys.includes(resource.projectKey))
      return deny(`project "${resource.projectKey}" is outside the grant scope`);
  }
  if (scope.repositoryIds?.length && resource.repositoryId) {
    if (!scope.repositoryIds.includes(resource.repositoryId))
      return deny("repository is outside the grant scope");
  }
  if (scope.allowedPaths?.length && resource.path) {
    const allowed = scope.allowedPaths.some((p) => {
      const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
      return resource.path === abs || resource.path.startsWith(abs + path.sep);
    });
    if (!allowed) return deny("path is outside the grant scope");
  }
}
