import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { CapabilityDenied } from "../lib/policy";
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
import { speakText, type SpeakTextInput, type SpeakTextOutput } from "./speakText";

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
  speak_text: {
    capability: "voice.speak" as const,
    kind: "read" as const,
    run: (input: SpeakTextInput, runId?: string) => speakText(input, runId),
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
    // instanceof, not a message prefix: rewording CapabilityDenied's message
    // would otherwise silently downgrade a denial to a generic failure.
    //
    // No capability_denied event is written here. assertCapability already
    // records one, and it carries the actual reason ("grant is disabled",
    // "path is outside the grant scope") where this one only ever repeated
    // the caller's purpose. Every denial used to produce two ledger rows
    // saying different things. The tool's name is not lost: it is on the
    // ToolCall row below, with status=denied.
    const status = err instanceof CapabilityDenied ? "denied" : "failed";
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
