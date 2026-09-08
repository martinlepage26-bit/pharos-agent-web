import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { assertCapability } from "../lib/policy";
import { recordAudit } from "../lib/audit";

/**
 * ECHO — the one voice, the one engine.
 *
 * This tool used to call a second local engine (F5-TTS on 5434) with its
 * own resampled copy of the reference clip. Both rendered the same
 * 22.13-second recording, so the agent had been speaking in ECHO without
 * anything in the system knowing that is what it was. `pharos-say`
 * already carries a "Martin lock" (2026-09-05) pinning the PHAROS mouth
 * to echosay and refusing every fallback; nothing enforced that lock
 * outside pharos-say, and this tool walked straight past it.
 *
 * Now there is one engine (echosay, Coqui XTTS-v2 on 8765), one
 * reference, and a checksum that makes the reference canonical: if it
 * moves or changes, this refuses to speak rather than quietly rendering
 * a different voice.
 */
const ECHOSAY_BASE = process.env.PHAROS_ECHOSAY_URL ?? "http://127.0.0.1:8765";

/** The canonical ECHO reference. Same rule as pharos-say: fail loudly. */
const ECHO_REFERENCE =
  process.env.PHAROS_ECHO_REFERENCE ??
  path.join(os.homedir(), ".local/share/echo-voice/reference.wav");

/** sha256 of the 22.13s reference as of 2026-09-07. */
const ECHO_REFERENCE_SHA256 =
  process.env.PHAROS_ECHO_REFERENCE_SHA256 ??
  "1367bb796d941ec4cf8d221b7e971be27ab14966394faa8e254dc6fb4c67c67c";

/**
 * XTTS on this machine, measured 2026-09-07:
 *
 *   chars    40    120    300    571
 *   seconds  4.7   29.8   144.9  202.8      (571 also seen at 483)
 *   s/char   0.12  0.25   0.48   0.36
 *
 * Superlinear to about 300 characters, then flattening, and noisy enough
 * across runs to make any single figure a fiction. 0.5 s/char is a
 * deliberately pessimistic straight line through that: it over-estimates
 * short lines, which is the harmless direction, because the number is
 * only used for a progress readout and for the caller's timeout budget.
 *
 * MAX_CHARS is a time budget rather than a length preference — 600
 * characters is somewhere between three and eight minutes of rendering.
 */
const MAX_CHARS = 600;
const SECONDS_PER_CHAR = 0.5;

export type SpeakTextInput = { briefId?: string; text?: string };
export type SpeakTextOutput = {
  jobId: string;
  chars: number;
  cached: boolean;
  estimatedSeconds: number;
};

export class SpeakError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** Markdown → speakable plain text (so the voice never reads "# * |" aloud). */
export function stripMarkdown(md: string): string {
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

/**
 * Verify the canonical reference before every synthesis.
 *
 * The point of the lock is that ECHO cannot drift. Checking the file's
 * digest is what makes "canonical" mean something: swap the clip and the
 * agent stops speaking instead of speaking as someone else.
 */
export function assertCanonicalVoice(): void {
  if (!existsSync(ECHO_REFERENCE)) {
    throw new SpeakError(
      503,
      `ECHO reference missing at ${ECHO_REFERENCE} — refusing to speak in another voice`
    );
  }
  const actual = createHash("sha256")
    .update(readFileSync(ECHO_REFERENCE))
    .digest("hex");
  if (actual !== ECHO_REFERENCE_SHA256) {
    throw new SpeakError(
      503,
      "ECHO reference has changed — refusing to speak until it is restored or the checksum is updated deliberately",
      `expected ${ECHO_REFERENCE_SHA256.slice(0, 16)}…, found ${actual.slice(0, 16)}…`
    );
  }
}

/**
 * Where a rendered line lands. Keyed by the digest of the text, so the
 * same line is synthesised once and replayed thereafter — the same
 * economy pharos-say gets from its mp3 cache, and the only thing that
 * makes an eight-minute engine tolerable for repeated phrases.
 *
 * Deriving the path from the content also means no job state is held in
 * this process: whether a job is finished is a question about the
 * filesystem, so it survives a dev-server reload.
 */
function clipPath(jobId: string): string {
  return path.join(os.tmpdir(), `pharos-echo-${jobId}.wav`);
}

export function jobIdFor(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function readClip(jobId: string): { path: string; bytes: number } | null {
  const p = clipPath(jobId);
  if (!existsSync(p)) return null;
  const s = statSync(p);
  // A zero-byte file is echosay still writing; treat it as not ready.
  return s.size > 0 ? { path: p, bytes: s.size } : null;
}

export async function speakText(
  input: SpeakTextInput,
  runId?: string
): Promise<SpeakTextOutput> {
  await assertCapability("voice.speak", {}, runId);
  assertCanonicalVoice();

  let clean: string;
  if (typeof input.briefId === "string") {
    const brief = await prisma.briefDraft.findUnique({
      where: { id: input.briefId },
      select: { content: true },
    });
    if (!brief) throw new SpeakError(404, "brief not found");
    clean = stripMarkdown(brief.content).slice(0, MAX_CHARS);
  } else if (typeof input.text === "string" && input.text.trim()) {
    clean = stripMarkdown(input.text).slice(0, MAX_CHARS);
  } else {
    throw new SpeakError(400, "text required");
  }
  if (!clean) throw new SpeakError(400, "nothing to say");

  const jobId = jobIdFor(clean);
  const estimatedSeconds = Math.ceil(clean.length * SECONDS_PER_CHAR);

  if (readClip(jobId)) {
    await recordAudit({
      runId,
      eventType: "tool_called",
      actor: "agent",
      toolName: "speak_text",
      capability: "voice.speak",
      outcome: "success",
      purpose: `ECHO cache hit · ${clean.length} chars · job ${jobId}`,
    });
    return { jobId, chars: clean.length, cached: true, estimatedSeconds: 0 };
  }

  // echosay is synchronous and slow, so the request is deliberately not
  // awaited: the caller polls for the clip. Failures are reported into
  // the ledger by the continuation rather than to the caller, who has
  // already been handed a job id.
  const started = Date.now();
  void fetch(`${ECHOSAY_BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean, save_path: clipPath(jobId) }),
    signal: AbortSignal.timeout(30 * 60_000),
  })
    .then(async (res) => {
      const ok = res.ok && readClip(jobId) !== null;
      await recordAudit({
        runId,
        eventType: "tool_called",
        actor: "agent",
        toolName: "speak_text",
        capability: "voice.speak",
        outcome: ok ? "success" : "failed",
        purpose: ok
          ? `ECHO rendered ${clean.length} chars in ${Math.round((Date.now() - started) / 1000)}s · job ${jobId}`
          : `echosay returned ${res.status} and produced no clip · job ${jobId}`,
      });
    })
    .catch(async (e) => {
      await recordAudit({
        runId,
        eventType: "tool_called",
        actor: "agent",
        toolName: "speak_text",
        capability: "voice.speak",
        outcome: "failed",
        purpose: `echosay unreachable: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"} · job ${jobId}`,
      });
    });

  await recordAudit({
    runId,
    eventType: "tool_called",
    actor: "agent",
    toolName: "speak_text",
    capability: "voice.speak",
    outcome: "success",
    purpose: `ECHO queued ${clean.length} chars, ~${estimatedSeconds}s · job ${jobId}`,
  });

  return { jobId, chars: clean.length, cached: false, estimatedSeconds };
}

export async function echosayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${ECHOSAY_BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export { ECHOSAY_BASE, ECHO_REFERENCE, MAX_CHARS };
export const clipFor = clipPath;
export const removeClip = (jobId: string) => fs.rm(clipPath(jobId), { force: true });
