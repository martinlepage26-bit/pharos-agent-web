import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const VOICE_BASE = process.env.PHAROS_VOICE_URL ?? "http://127.0.0.1:5434";

/** Markdown → speakable plain text (so the voice never reads "# * |" aloud). */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\|[\s:|-]+\|$/gm, " ")
    .replace(/^\|.*\|$/gm, (line) => line.replace(/\|/g, " ").replace(/\s+/g, " "))
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[*_>#]+/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const dynamic = "force-dynamic";

/**
 * GET /api/speak           → voice engine health
 * GET /api/speak?job=<id>  → poll an engine job: 202 running, 200 audio/wav
 */
export async function GET(request: NextRequest) {
  const job = request.nextUrl.searchParams.get("job");
  if (job) {
    try {
      const res = await fetch(`${VOICE_BASE}/job/${encodeURIComponent(job)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 202) {
        return NextResponse.json({ status: "running" }, { status: 202 });
      }
      if (res.ok) {
        const data = (await res.json()) as { audio?: string };
        if (!data.audio) {
          return NextResponse.json({ error: "missing audio" }, { status: 502 });
        }
        const buf = Buffer.from(data.audio, "base64");
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(buf.byteLength),
            "Cache-Control": "no-store",
          },
        });
      }
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { status: "failed", detail: detail.slice(0, 200) },
        { status: 502 },
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "voice engine unreachable" },
        { status: 502 },
      );
    }
  }

  try {
    const res = await fetch(`${VOICE_BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      return NextResponse.json(
        { ok: false, error: "voice engine unhealthy", engine: data },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      engine: "F5-TTS",
      engineUrl: VOICE_BASE,
      model: data.model ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "voice engine unreachable" },
      { status: 502 },
    );
  }
}

/**
 * POST {briefId} or {text} → {jobId}. Synthesis runs as a background job
 * on the local engine (long texts take minutes on this hardware); poll
 * GET /api/speak?job=<id> until it returns audio. Local synthesis
 * (F5-TTS); every call is audited like any other tool use.
 */
export async function POST(request: NextRequest) {
  let clean = "";
  let purpose = "speak raw text (local F5-TTS)";
  try {
    const body = await request.json();
    if (typeof body?.briefId === "string") {
      const brief = await prisma.briefDraft.findUnique({
        where: { id: body.briefId },
        select: { content: true, language: true },
      });
      if (!brief) {
        return NextResponse.json({ error: "brief not found" }, { status: 404 });
      }
      clean = stripMarkdown(brief.content).slice(0, 1200);
      purpose = `speak ${brief.language} brief ${body.briefId.slice(0, 8)} (local F5-TTS)`;
    } else if (typeof body?.text === "string" && body.text.trim()) {
      clean = stripMarkdown(body.text).slice(0, 1200);
    } else {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    if (!clean) {
      return NextResponse.json({ error: "nothing to say" }, { status: 400 });
    }

    const res = await fetch(`${VOICE_BASE}/tts/async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await recordAudit({
        eventType: "tool_called",
        actor: "agent",
        toolName: "speak_text",
        capability: "voice.speak",
        outcome: "failed",
        purpose: detail.slice(0, 200),
      });
      return NextResponse.json(
        { error: `voice engine returned ${res.status}`, detail: detail.slice(0, 200) },
        { status: 502 },
      );
    }
    const { job_id } = (await res.json()) as { job_id?: string };
    if (!job_id) {
      return NextResponse.json({ error: "voice engine returned no job id" }, { status: 502 });
    }
    await recordAudit({
      eventType: "tool_called",
      actor: "agent",
      toolName: "speak_text",
      capability: "voice.speak",
      outcome: "success",
      purpose: `${purpose} · ${clean.length} chars · job ${job_id}`,
    });
    return NextResponse.json({ jobId: job_id });
  } catch (err) {
    await recordAudit({
      eventType: "tool_called",
      actor: "agent",
      toolName: "speak_text",
      capability: "voice.speak",
      outcome: "failed",
      purpose: err instanceof Error ? err.message.slice(0, 200) : "voice engine unreachable",
    }).catch(() => {});
    return NextResponse.json(
      {
        error:
          "voice engine offline — is LaunchAgent ca.pharos.voice running? (launchctl kickstart -k gui/$(id -u)/ca.pharos.voice)",
      },
      { status: 503 },
    );
  }
}
