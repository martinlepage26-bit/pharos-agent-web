import { prisma } from "../lib/prisma";
import { assertCapability, CapabilityDenied } from "../lib/policy";
import { recordAudit } from "../lib/audit";

export type GithubActivityInput = {
  projectKey: string;
  days?: number;
};

export type GithubActivityOutput = {
  status: "ok" | "not_configured";
  repositories: Array<{
    repo: string;
    issues: number;
  }>;
  note?: string;
};

/**
 * Tool: get_github_project_activity
 * Scope: repositories explicitly registered as github_repo sources for the
 * project. Read-only. Requires GITHUB_TOKEN; without it the tool reports
 * not_configured instead of fabricating results.
 */
export async function getGithubProjectActivity(
  input: GithubActivityInput,
  runId?: string
): Promise<GithubActivityOutput> {
  await assertCapability("github.read", { projectKey: input.projectKey }, runId);

  const token = process.env.GITHUB_TOKEN;
  const sources = await prisma.source.findMany({
    where: {
      project: { key: input.projectKey },
      kind: "github_repo",
      enabled: true,
    },
  });

  if (!token || sources.length === 0) {
    await recordAudit({
      runId,
      eventType: "tool_called",
      actor: "agent",
      toolName: "get_github_project_activity",
      capability: "github.read",
      outcome: "success",
      purpose: "no token or no registered repos — reported not_configured",
    });
    return {
      status: "not_configured",
      repositories: [],
      note: token
        ? "No github_repo sources registered for this project."
        : "GITHUB_TOKEN not set. Add it to .env to enable read-only GitHub activity.",
    };
  }

  const repositories: GithubActivityOutput["repositories"] = [];
  const denied: string[] = [];

  for (const s of sources) {
    if (!s.repoFullName) continue;

    // Name the repository so the grant's repositoryIds allowlist actually
    // applies. Without this the allowlist was unreachable dead code: the
    // restriction shown in /sources was never evaluated, and the only
    // thing narrowing access was this tool's own query.
    try {
      await assertCapability(
        "github.read",
        { projectKey: input.projectKey, repositoryId: s.repoFullName },
        runId
      );
    } catch (err) {
      if (err instanceof CapabilityDenied) {
        denied.push(s.repoFullName);
        continue;
      }
      throw err;
    }

    const res = await fetch(
      `https://api.github.com/repos/${s.repoFullName}?state=open&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!res.ok) continue;
    const repo = (await res.json()) as { open_issues_count?: number };
    repositories.push({
      repo: s.repoFullName,
      issues: repo.open_issues_count ?? 0,
    });
  }

  await recordAudit({
    runId,
    eventType: "tool_called",
    actor: "agent",
    toolName: "get_github_project_activity",
    capability: "github.read",
    outcome: "success",
    resourceRef: input.projectKey,
    purpose:
      `${repositories.length} repo(s) read` +
      (denied.length ? `; ${denied.length} denied by grant scope` : ""),
  });

  // Report the denials rather than silently returning a short list — an
  // omitted repository must not look like a repository with no activity.
  return {
    status: "ok",
    repositories,
    note: denied.length
      ? `Not read (outside the github.read grant scope): ${denied.join(", ")}.`
      : undefined,
  };
}
