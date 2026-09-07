import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import {
  searchProjectDocuments,
  type SearchInput,
  type SearchOutput,
} from "./searchProjectDocuments";
import {
  getGithubProjectActivity,
  type GithubActivityInput,
  type GithubActivityOutput,
} from "./getGithubProjectActivity";
import {
  getCalendarAgenda,
  type CalendarAgendaInput,
  type CalendarAgendaOutput,
} from "./getCalendarAgenda";
import {
  createLocalBriefDraft,
  type CreateDraftInput,
  type CreateDraftOutput,
} from "./createLocalBriefDraft";

/**
 * The v1 tool registry. Every tool is typed, scoped, logged, and — apart
 * from the local-drafts writer — read-only. Tools deliberately omitted
 * from v1: send_email, post_message, merge_pull_request, shell execution,
 * browser automation, unrestricted filesystem access.
 */

export const TOOL_REGISTRY = {
  search_project_documents: {
    capability: "documents.search" as const,
    kind: "read" as const,
    run: (input: SearchInput, runId?: string) =>
      searchProjectDocuments(input, runId),
  },
  get_github_project_activity: {
    capability: "github.read" as const,
    kind: "read" as const,
    run: (input: GithubActivityInput, runId?: string) =>
      getGithubProjectActivity(input, runId),
  },
  get_calendar_agenda: {
    capability: "calendar.read" as const,
    kind: "read" as const,
    run: (input: CalendarAgendaInput, runId?: string) =>
      getCalendarAgenda(input, runId),
  },
  create_local_brief_draft: {
    capability: "drafts.write" as const,
    kind: "write" as const,
    run: (input: CreateDraftInput, runId?: string) =>
      createLocalBriefDraft(input, runId),
  },
} as const;

export type ToolName = keyof typeof TOOL_REGISTRY;

export async function callTool(
  runId: string,
  toolName: ToolName,
  input: unknown,
  purpose: string
) {
  const spec = TOOL_REGISTRY[toolName];
  try {
    const output = await (spec.run as (i: unknown, r?: string) => unknown)(
      input,
      runId
    );
    const outputSummary = summarize(output);
    await prisma.toolCall.create({
      data: {
        runId,
        toolName,
        capability: spec.capability,
        purpose,
        status: "success",
        inputJson: JSON.stringify(input ?? {}),
        outputSummary,
      },
    });
    return output;
  } catch (err) {
    const status =
      err instanceof Error && err.message.startsWith("Capability denied")
        ? "denied"
        : "failed";
    if (status === "denied") {
      await recordAudit({
        runId,
        eventType: "capability_denied",
        actor: "system",
        toolName,
        capability: spec.capability,
        purpose,
        outcome: "denied",
      });
    }
    await prisma.toolCall.create({
      data: {
        runId,
        toolName,
        capability: spec.capability,
        purpose,
        status,
        inputJson: JSON.stringify(input ?? {}),
        outputSummary: err instanceof Error ? err.message.slice(0, 500) : "error",
      },
    });
    throw err;
  }
}

function summarize(output: unknown): string {
  if (output === null || output === undefined) return "no output";
  if (output && typeof output === "object" && "hits" in output) {
    const o = output as SearchOutput;
    return `${o.total} hit(s)`;
  }
  const s = JSON.stringify(output);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}
