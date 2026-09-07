import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { isCrossSite, sameOriginRedirect } from "@/lib/sameOrigin";

/**
 * Memory lifecycle — contract §4: every memory item is inspectable,
 * editable, expirable and deletable in the UI. Until now /sources
 * rendered a read-only table and three of those four verbs did not
 * exist.
 *
 * The agent has no capability to reach this route. Curation is the
 * operator's act, not the agent's, so it is gated on same-origin rather
 * than on a CapabilityGrant — but it is audited, because curated memory
 * feeds every brief and a silent edit to it is a silent edit to the
 * agent's conclusions.
 */
export const dynamic = "force-dynamic";

const CONFIDENCE = ["confirmed", "inferred", "needs_review"] as const;

function back(request: Request) {
  return NextResponse.redirect(sameOriginRedirect(request, "/sources"), 303);
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  if (isCrossSite(request)) return bad("cross-site requests are not accepted", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("expected form-encoded body", 415);
  }

  const id = String(form.get("id") ?? "");
  const action = String(form.get("action") ?? "");
  if (!id) return bad("id is required");

  const item = await prisma.memoryItem.findUnique({ where: { id } });
  if (!item) return bad("memory item not found", 404);

  // Truncated so a long statement cannot bloat every ledger row.
  const ref = `${item.kind}/${item.category ?? "note"}: ${item.statement.slice(0, 80)}`;

  if (action === "update") {
    const statement = String(form.get("statement") ?? "").trim();
    const confidence = String(form.get("confidence") ?? "");
    if (!statement) return bad("statement cannot be empty");
    if (!(CONFIDENCE as readonly string[]).includes(confidence)) {
      return bad(`confidence must be one of: ${CONFIDENCE.join(", ")}`);
    }

    await prisma.memoryItem.update({
      where: { id },
      data: { statement, confidence },
    });
    await recordAudit({
      eventType: "memory_updated",
      actor: "user",
      resourceRef: ref,
      purpose: `confidence=${confidence}; ${statement.length} chars`,
      outcome: "success",
    });
    return back(request);
  }

  if (action === "expire") {
    // Expiry withdraws the item from synthesis without destroying it, so
    // the provenance of past briefs stays intact.
    const raw = String(form.get("expiresAt") ?? "").trim();
    const expiresAt = raw ? new Date(raw) : new Date();
    if (Number.isNaN(expiresAt.getTime())) return bad("invalid expiresAt");

    await prisma.memoryItem.update({ where: { id }, data: { expiresAt } });
    await recordAudit({
      eventType: "memory_expired",
      actor: "user",
      resourceRef: ref,
      purpose: `expiresAt=${expiresAt.toISOString()}`,
      outcome: "success",
    });
    return back(request);
  }

  if (action === "restore") {
    await prisma.memoryItem.update({ where: { id }, data: { expiresAt: null } });
    await recordAudit({
      eventType: "memory_updated",
      actor: "user",
      resourceRef: ref,
      purpose: "expiry cleared",
      outcome: "success",
    });
    return back(request);
  }

  if (action === "delete") {
    // Audited BEFORE the row goes, so the ledger records what was removed
    // even though the item itself is gone. The ledger is append-only, so
    // this entry survives the deletion permanently.
    await recordAudit({
      eventType: "memory_deleted",
      actor: "user",
      resourceRef: ref,
      purpose: `sourceRefs=${item.sourceRefs}`,
      outcome: "success",
    });
    await prisma.memoryItem.delete({ where: { id } });
    return back(request);
  }

  return bad(`unknown action "${action}"`);
}
