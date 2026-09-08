import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { recordAudit } from "./audit";

const OPENROUTER_KEY_FILE =
  process.env.PHAROS_OPENROUTER_KEY_FILE ??
  "/Users/pharos_ai/pharos/state/openrouter.key";

/**
 * Resolve the synthesis key, and say so when it cannot.
 *
 * The bare catch here swallowed everything: a permissions change, a typo
 * in PHAROS_OPENROUTER_KEY_FILE, or `require` being undefined under an ESM
 * bundle all produced the same silent null and the same silent drop to the
 * template. Nothing distinguished "deliberately offline" from
 * "misconfigured". An absent file is the ordinary case and stays quiet;
 * anything else is now reported.
 */
export function resolveApiKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (!existsSync(OPENROUTER_KEY_FILE)) return null;
  try {
    // readFileSync is imported statically — the previous require() call
    // would have thrown ReferenceError in an ESM bundle, indistinguishably
    // from the key being missing.
    const key = readFileSync(OPENROUTER_KEY_FILE, "utf8").trim();
    if (key.length > 0) return key;
    console.error(`[pharos-agent] key file ${OPENROUTER_KEY_FILE} is empty`);
    return null;
  } catch (e) {
    console.error(
      `[pharos-agent] key file ${OPENROUTER_KEY_FILE} exists but could not be read: ${
        e instanceof Error ? e.message : "unknown"
      }`
    );
    return null;
  }
}

export const MODEL = process.env.PHAROS_AGENT_MODEL ?? "anthropic/claude-sonnet-4.5";

/**
 * Optional synthesis step. If no key is available the caller falls back
 * to a deterministic template brief — the build never depends on a
 * cloud model to function.
 */
export async function synthesize(
  systemPrompt: string,
  userPrompt: string,
  runId: string,
  /** Document paths whose excerpts are inside userPrompt. */
  sourcePaths: string[] = []
): Promise<string | null> {
  const key = resolveApiKey();
  if (!key) return null;

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  // This is the only path on which anything leaves the machine, and it
  // was the one path with no ledger entry: excerpts of the user's
  // documents and their full paths were transmitted, a failure printed
  // to stderr, and the run closed as run_completed/success either way.
  // Record the egress before the request, so an attempt that never
  // returns is still on the record.
  //
  // What is logged is the shape of the transfer, never its content: the
  // endpoint, the model, the byte count, and which documents were drawn
  // on. The key is never logged.
  const egress = {
    runId,
    actor: "system" as const,
    capability: "model.synthesis",
    resourceRef: "openrouter.ai/api/v1/chat/completions",
  };
  await recordAudit({
    ...egress,
    eventType: "egress_attempted",
    purpose: `model=${MODEL}; ${body.length} bytes; ${sourcePaths.length} document(s): ${sourcePaths.join(", ").slice(0, 400)}`,
  });

  const fail = async (reason: string) => {
    console.error(`[pharos-agent] synthesis failed for run ${runId}: ${reason}`);
    await recordAudit({
      ...egress,
      eventType: "egress_completed",
      outcome: "failed",
      purpose: reason.slice(0, 300),
    });
    return null;
  };

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (e) {
    return fail(
      `network error — ${e instanceof Error ? e.message : "unknown"}; falling back to template`
    );
  }

  if (!res.ok) return fail(`OpenRouter returned ${res.status}`);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return fail("response was not JSON");
  }
  const text = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    return fail("response contained no content");
  }

  await recordAudit({
    ...egress,
    eventType: "egress_completed",
    outcome: "success",
    purpose: `model=${MODEL}; ${body.length} bytes sent; ${text.length} chars returned`,
  });
  return text;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Reduce one path segment to [a-z0-9-]. Used for every user- or
 * caller-supplied component of a draft filename, so that no input can
 * introduce a separator, a "..", or anything else that survives path.join.
 */
export function slugSegment(
  value: string,
  fallback: string,
  opts: { preserveCase?: boolean } = {}
): string {
  const base = opts.preserveCase ? value : value.toLowerCase();
  return (
    base.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "") || fallback
  );
}

/**
 * Anchor the repository root to this module's location rather than to
 * process.cwd(). With a cwd-relative root, DRAFTS_DIR and the grant's
 * allowedPaths resolve against the same moving base, so the containment
 * check could never fail — and drafts were in fact written outside the
 * repository. `typeof __dirname` is safe under ESM (no ReferenceError).
 */
function findRepoRoot(): string {
  let dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  // Look for *this* package, not merely any package.json. Next writes
  // `.next/package.json` containing `{"type":"commonjs"}`, and under the
  // server bundle __dirname sits below it — so a bare existence check
  // stopped there and every web-triggered brief was written into
  // .next/drafts/, which `next build` deletes. Consistent, and wrong:
  // the same shape of bug as the process.cwd() version this replaced.
  for (let i = 0; i < 12; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
        if (parsed.name === "pharos-agent") return dir;
      } catch {
        // Unreadable or malformed: keep walking rather than anchor here.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

export const REPO_ROOT = findRepoRoot();
export const DRAFTS_DIR = path.join(REPO_ROOT, "drafts");

export async function ensureDraftsDir(): Promise<void> {
  await fs.mkdir(DRAFTS_DIR, { recursive: true });
}
