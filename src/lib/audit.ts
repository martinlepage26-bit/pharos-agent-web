import { prisma } from "@/lib/prisma";
import type { AuditEvent } from "@prisma/client";

/**
 * Append-only audit ledger. Every meaningful action in pharos-agent
 * lands here: run lifecycle, tool calls, approvals, denials.
 */
export async function recordAudit(event: {
  runId?: string | null;
  eventType:
    | "run_started"
    | "retrieval_completed"
    | "tool_called"
    | "draft_created"
    | "approval_requested"
    | "approval_granted"
    | "approval_denied"
    | "capability_denied"
    | "run_completed"
    | "run_failed"
    | "ingestion_completed";
  actor: "user" | "agent" | "system";
  toolName?: string;
  capability?: string;
  resourceRef?: string;
  purpose?: string;
  outcome?: "success" | "denied" | "failed";
}): Promise<AuditEvent> {
  return prisma.auditEvent.create({
    data: {
      runId: event.runId ?? null,
      eventType: event.eventType,
      actor: event.actor,
      toolName: event.toolName,
      capability: event.capability,
      resourceRef: event.resourceRef,
      purpose: event.purpose,
      outcome: event.outcome,
    },
  });
}
