import { assertCapability } from "../lib/policy";
import { recordAudit } from "../lib/audit";

export type CalendarAgendaInput = {
  projectKey: string;
};

export type CalendarAgendaOutput = {
  status: "ok" | "not_configured";
  events: Array<{ title: string; start: string; participants: string[] }>;
  note?: string;
};

/**
 * Tool: get_calendar_agenda
 * v1 stub. A read-only macOS EventKit adapter is the planned Phase 2
 * addition; until then the tool honestly reports not_configured rather
 * than returning fabricated agenda data.
 */
export async function getCalendarAgenda(
  input: CalendarAgendaInput,
  runId?: string
): Promise<CalendarAgendaOutput> {
  await assertCapability("calendar.read", { projectKey: input.projectKey }, runId);

  await recordAudit({
    runId,
    eventType: "tool_called",
    actor: "agent",
    toolName: "get_calendar_agenda",
    capability: "calendar.read",
    outcome: "success",
    purpose: "v1 stub — reported not_configured",
  });

  return {
    status: "not_configured",
    events: [],
    note: "Calendar adapter arrives in Phase 2 (read-only EventKit bridge).",
  };
}
