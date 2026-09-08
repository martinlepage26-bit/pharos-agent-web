import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { callTool } from "@/tools/registry";
import {
  SpeakError,
  readClip,
  readManifest,
  echosayHealthy,
  assertCanonicalVoice,
  ECHOSAY_BASE,
  ECHO_REFERENCE,
  MAX_CHARS,
  type SpeakTextOutput,
} from "@/tools/speakText";
import { CapabilityDenied } from "@/lib/policy";

export const dynamic = "force-dynamic";

/**
 * GET /api/speak            → ECHO engine health and voice provenance
 * GET /api/speak?job=<id>   → the chunk manifest with per-chunk readiness
 * GET /api/speak?clip=<id>  → 202 while rendering, 200 audio/wav when done
 *
 * Readiness and audio are separate so a caller can start playing chunk
 * one while the rest are still being rendered — the whole point of
 * chunking against an engine this slow.
 */
export async function GET(request: NextRequest) {
  const clipId = request.nextUrl.searchParams.get("clip");
  if (clipId) {
    const clip = readClip(clipId);
    if (!clip) return NextResponse.json({ status: "running" }, { status: 202 });
    const buf = await fs.readFile(clip.path);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  }

  const job = request.nextUrl.searchParams.get("job");
  if (job) {
    const manifest = readManifest(job);
    if (!manifest) return NextResponse.json({ error: "unknown job" }, { status: 404 });
    const chunks = manifest.chunks.map((c) => ({
      id: c.id,
      chars: c.chars,
      ready: readClip(c.id) !== null,
    }));
    return NextResponse.json({
      jobId: manifest.jobId,
      chunks,
      ready: chunks.filter((c) => c.ready).length,
      total: chunks.length,
      done: chunks.every((c) => c.ready),
    });
  }

  let voice: "canonical" | "missing" | "changed" = "canonical";
  let voiceDetail: string | undefined;
  try {
    assertCanonicalVoice();
  } catch (e) {
    voice = e instanceof SpeakError && e.message.includes("missing") ? "missing" : "changed";
    voiceDetail = e instanceof Error ? e.message : undefined;
  }

  const healthy = await echosayHealthy();
  return NextResponse.json(
    {
      ok: healthy && voice === "canonical",
      engine: "Coqui XTTS-v2 (echosay)",
      engineUrl: ECHOSAY_BASE,
      engineHealthy: healthy,
      voice: "ECHO",
      voiceState: voice,
      voiceDetail,
      reference: ECHO_REFERENCE,
      maxChars: MAX_CHARS,
      note: "Locked to the local ECHO reference. No fallback voice: if the engine is down or the reference has changed, the agent stays silent.",
    },
    { status: healthy && voice === "canonical" ? 200 : 503 }
  );
}

/**
 * POST {briefId} or {text} → {jobId}. Rendering happens in the echosay
 * process; poll GET /api/speak?job=<id> for the audio. A line already
 * rendered comes back immediately, because clips are keyed by the digest
 * of their text.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  const briefId = typeof body.briefId === "string" ? body.briefId : undefined;
  const text = typeof body.text === "string" ? body.text : undefined;
  const purpose = briefId
    ? `speak brief ${briefId.slice(0, 8)} in ECHO`
    : "speak raw text in ECHO";

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
    return NextResponse.json({
      jobId: out.jobId,
      runId: run.id,
      chunks: out.chunks,
      cached: out.cached,
      chars: out.chars,
      estimatedSeconds: out.estimatedSeconds,
    });
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date() },
    });

    if (err instanceof CapabilityDenied) {
      return NextResponse.json({ error: err.message, runId: run.id }, { status: 403 });
    }
    if (err instanceof SpeakError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail, runId: run.id },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "speak failed", runId: run.id },
      { status: 500 }
    );
  }
}
