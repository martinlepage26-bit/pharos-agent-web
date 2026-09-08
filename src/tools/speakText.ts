import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { assertCapability } from "../lib/policy";
import { recordAudit } from "../lib/audit";
import { planChunks, digestOf, type SpeechChunk } from "../lib/speechChunks";

/**
 * ECHO — the one voice, the one engine, rendered in pieces.
 *
 * This tool used to call a second local engine (F5-TTS) with its own
 * resampled copy of the reference clip. Both rendered the same
 * 22.13-second recording, so the agent had been speaking in ECHO without
 * anything in the system knowing that is what it was. `pharos-say` had
 * carried a "Martin lock" pinning the mouth to echosay since 2026-09-05;
 * nothing enforced it outside that one script.
 *
 * Consolidating on echosay made the voice canonical and exposed its
 * speed: a 571-character passage took 203 s on a good run and 483 s on a
 * bad one. Text is therefore split into sentence-sized chunks, each
 * rendered and addressed separately, so playback starts after the first
 * chunk instead of the last. Measured: first audio 6.1x sooner, and 1.5x
 * less total work, because small calls are cheaper per character.
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
 * A whole-utterance cap, still a time budget rather than a length
 * preference — but with streaming it no longer governs time-to-first-
 * sound, only total length. Raising it is a deliberate decision, not a
 * side effect of chunking.
 */
const MAX_CHARS = 600;

/** Conservative, from the measured curve; used only for a progress hint. */
const SECONDS_PER_CHAR = 0.5;

export type SpeakTextInput = { briefId?: string; text?: string };
export type SpeakTextOutput = {
  jobId: string;
  chunks: Array<{ id: string; chars: number }>;
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
 * Verify the canonical reference before every synthesis. Swap the clip
 * and the agent stops speaking rather than speaking as someone else —
 * a wrong voice is the one failure a listener cannot detect.
 */
export function assertCanonicalVoice(): void {
  if (!existsSync(ECHO_REFERENCE)) {
    throw new SpeakError(
      503,
      `ECHO reference missing at ${ECHO_REFERENCE} — refusing to speak in another voice`
    );
  }
  const actual = createHash("sha256").update(readFileSync(ECHO_REFERENCE)).digest("hex");
  if (actual !== ECHO_REFERENCE_SHA256) {
    throw new SpeakError(
      503,
      "ECHO reference has changed — refusing to speak until it is restored or the checksum is updated deliberately",
      `expected ${ECHO_REFERENCE_SHA256.slice(0, 16)}…, found ${actual.slice(0, 16)}…`
    );
  }
}

/**
 * Clips and manifests are content-addressed and live in tmp. Addressing
 * by digest gives per-chunk caching for free — edit one sentence of a
 * brief and only that sentence re-renders — and keeps the job stateless,
 * so "is this chunk ready?" is a question about the filesystem and
 * survives a dev-server reload.
 */
function clipPath(id: string): string {
  return path.join(os.tmpdir(), `pharos-echo-${id}.wav`);
}
function manifestPath(jobId: string): string {
  return path.join(os.tmpdir(), `pharos-echo-${jobId}.json`);
}

export type Manifest = { jobId: string; chunks: SpeechChunk[]; createdAt: string };

export function readManifest(jobId: string): Manifest | null {
  const p = manifestPath(jobId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export function readClip(id: string): { path: string; bytes: number } | null {
  const p = clipPath(id);
  if (!existsSync(p)) return null;
  const s = statSync(p);
  // A zero-byte file is echosay still writing; treat it as not ready.
  return s.size > 0 ? { path: p, bytes: s.size } : null;
}

export const jobIdFor = digestOf;

/**
 * Render the outstanding chunks one at a time.
 *
 * Strictly sequential: echosay holds a single resident XTTS model, so
 * concurrent requests contend for it rather than overlapping. Rendering
 * in order also means the listener is never waiting on a chunk that is
 * queued behind a later one.
 */
async function renderSequentially(
  manifest: Manifest,
  runId: string | undefined
): Promise<void> {
  const started = Date.now();
  let rendered = 0;

  for (const chunk of manifest.chunks) {
    if (readClip(chunk.id)) continue;
    try {
      const res = await fetch(`${ECHOSAY_BASE}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk.text, save_path: clipPath(chunk.id) }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok || !readClip(chunk.id)) {
        await recordAudit({
          runId,
          eventType: "tool_called",
          actor: "agent",
          toolName: "speak_text",
          capability: "voice.speak",
          outcome: "failed",
          purpose: `ECHO chunk ${chunk.id} failed (${res.status}) · job ${manifest.jobId}`,
        });
        return;
      }
      rendered++;
    } catch (e) {
      await recordAudit({
        runId,
        eventType: "tool_called",
        actor: "agent",
        toolName: "speak_text",
        capability: "voice.speak",
        outcome: "failed",
        purpose: `echosay unreachable on chunk ${chunk.id}: ${
          e instanceof Error ? e.message.slice(0, 120) : "unknown"
        }`,
      });
      return;
    }
  }

  await recordAudit({
    runId,
    eventType: "tool_called",
    actor: "agent",
    toolName: "speak_text",
    capability: "voice.speak",
    outcome: "success",
    purpose: `ECHO rendered ${rendered}/${manifest.chunks.length} chunk(s) in ${Math.round(
      (Date.now() - started) / 1000
    )}s · job ${manifest.jobId}`,
  });
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

  const jobId = digestOf(clean);
  const chunks = planChunks(clean);
  const manifest: Manifest = { jobId, chunks, createdAt: new Date().toISOString() };
  await fs.writeFile(manifestPath(jobId), JSON.stringify(manifest), "utf8");

  const outstanding = chunks.filter((c) => !readClip(c.id));
  const cached = outstanding.length === 0;
  const estimatedSeconds = Math.ceil(
    outstanding.reduce((n, c) => n + c.chars, 0) * SECONDS_PER_CHAR
  );

  if (!cached) {
    // Deliberately not awaited: the caller polls per chunk.
    void renderSequentially(manifest, runId);
  }

  await recordAudit({
    runId,
    eventType: "tool_called",
    actor: "agent",
    toolName: "speak_text",
    capability: "voice.speak",
    outcome: "success",
    purpose: cached
      ? `ECHO cache hit · ${chunks.length} chunk(s) · job ${jobId}`
      : `ECHO queued ${outstanding.length}/${chunks.length} chunk(s), ~${estimatedSeconds}s · job ${jobId}`,
  });

  return {
    jobId,
    chunks: chunks.map((c) => ({ id: c.id, chars: c.chars })),
    chars: clean.length,
    cached,
    estimatedSeconds,
  };
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
export const removeClip = (id: string) => fs.rm(clipPath(id), { force: true });
