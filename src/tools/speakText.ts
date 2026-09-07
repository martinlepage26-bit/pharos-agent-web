import { prisma } from "../lib/prisma";
import { assertCapability } from "../lib/policy";
import { recordAudit } from "../lib/audit";

const VOICE_BASE = process.env.PHAROS_VOICE_URL ?? "http://127.0.0.1:5434";

/** Longest utterance handed to the engine in one job. */
const MAX_CHARS = 1200;

export type SpeakTextInput = {
  briefId?: string;
  text?: string;
};

export type SpeakTextOutput = {
  jobId: string;
  chars: number;
};

/**
 * Carries an HTTP status so the route can answer precisely without
 * re-deriving the cause from a message string.
 */
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
 * Tool: speak_text
 * Sends text to the local F5-TTS engine on the loopback interface and
 * returns a job id; the caller polls for the audio.
 *
 * This capability used to be exercised directly by the route with no
 * grant row and no registry entry — the contract's §9 rule is that a
 * capability is added by a grant plus a contract revision, never by
 * shipping code, so it is now a typed tool like any other.
 */
export async function speakText(
  input: SpeakTextInput,
  runId?: string
): Promise<SpeakTextOutput> {
  await assertCapability("voice.speak", {}, runId);

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

  let res: Response;
  try {
    res = await fetch(`${VOICE_BASE}/tts/async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new SpeakError(
      503,
      "voice engine offline — is LaunchAgent ca.pharos.voice running? (launchctl kickstart -k gui/$(id -u)/ca.pharos.voice)",
      err instanceof Error ? err.message.slice(0, 200) : undefined
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SpeakError(
      502,
      `voice engine returned ${res.status}`,
      detail.slice(0, 200)
    );
  }

  const { job_id } = (await res.json()) as { job_id?: string };
  if (!job_id) throw new SpeakError(502, "voice engine returned no job id");

  // callTool records the ToolCall row; the audit event is what surfaces the
  // call in the dashboard ledger feed, so emit it here like the other tools.
  await recordAudit({
    runId,
    eventType: "tool_called",
    actor: "agent",
    toolName: "speak_text",
    capability: "voice.speak",
    outcome: "success",
    purpose: `${input.briefId ? `brief ${input.briefId.slice(0, 8)}` : "raw text"} · ${clean.length} chars · job ${job_id}`,
  });

  return { jobId: job_id, chars: clean.length };
}
