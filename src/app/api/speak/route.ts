import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callTool } from "@/tools/registry";
import { SpeakError, type SpeakTextOutput } from "@/tools/speakText";
import { CapabilityDenied } from "@/lib/policy";

const VOICE_BASE = process.env.PHAROS_VOICE_URL ?? "http://127.0.0.1:5434";

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
 * GET /api/speak?job=<id> until it returns audio.
 *
 * The route is a thin caller: authorization, the brief lookup, and the
 * engine call all live in the speak_text tool, reached through callTool
 * so the call produces a ToolCall row against a real run. Previously this
 * body ran inline with no capability check and audited itself with a
 * null runId, so it appeared on no run page.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  const briefId = typeof body.briefId === "string" ? body.briefId : undefined;
  const text = typeof body.text === "string" ? body.text : undefined;
  const purpose = briefId
    ? `speak brief ${briefId.slice(0, 8)} (local F5-TTS)`
    : "speak raw text (local F5-TTS)";

  const run = await prisma.agentRun.create({
    data: { goal: purpose, status: "running" },
  });

  try {
    const out = (await callTool(
      run.id,
      "speak_text",
      { briefId, text },
      purpose
    )) as SpeakTextOutput;

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "completed", finishedAt: new Date() },
    });
    return NextResponse.json({ jobId: out.jobId, runId: run.id });
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date() },
    });

    if (err instanceof CapabilityDenied) {
      return NextResponse.json(
        { error: err.message, runId: run.id },
        { status: 403 },
      );
    }
    if (err instanceof SpeakError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail, runId: run.id },
        { status: err.status },
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "speak failed",
        runId: run.id,
      },
      { status: 500 },
    );
  }
}
