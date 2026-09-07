import path from "node:path";
import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import { REPO_ROOT } from "./models";

export type Capability =
  | "documents.search"
  | "github.read"
  | "calendar.read"
  | "drafts.write"
  | "voice.speak";

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

  // Scope checks fail CLOSED. If a grant declares a dimension, the caller
  // must supply a value for it; omitting the field used to skip the check
  // silently, which made a declared scope look enforced when it was not.
  const scope: Scope = JSON.parse(grant.resourceScopeJson || "{}");

  if (scope.projectKeys?.length) {
    if (!resource.projectKey)
      return deny("grant is scoped to projects but no project was supplied");
    if (!scope.projectKeys.includes(resource.projectKey))
      return deny(`project "${resource.projectKey}" is outside the grant scope`);
  }

  if (scope.repositoryIds?.length) {
    if (!resource.repositoryId)
      return deny("grant is scoped to repositories but no repository was supplied");
    if (!scope.repositoryIds.includes(resource.repositoryId))
      return deny("repository is outside the grant scope");
  }

  if (scope.allowedPaths?.length) {
    const target = resource.path;
    if (!target)
      return deny("grant is scoped to paths but no path was supplied");
    const allowed = scope.allowedPaths.some((p) => {
      const abs = path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
      return target === abs || target.startsWith(abs + path.sep);
    });
    if (!allowed)
      return deny(`path "${target}" is outside the grant scope`);
  }
}
