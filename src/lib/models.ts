import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const OPENROUTER_KEY_FILE =
  process.env.PHAROS_OPENROUTER_KEY_FILE ??
  "/Users/pharos_ai/pharos/state/openrouter.key";

export function resolveApiKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const key = require("node:fs").readFileSync(OPENROUTER_KEY_FILE, "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
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
  runId: string
): Promise<string | null> {
  const key = resolveApiKey();
  if (!key) return null;

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (e) {
    console.error(
      `[pharos-agent] synthesis network error for run ${runId}: ${
        e instanceof Error ? e.message : "unknown"
      } — falling back to template`
    );
    return null;
  }

  if (!res.ok) {
    console.error(`[pharos-agent] OpenRouter ${res.status} for run ${runId}`);
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const text = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  return typeof text === "string" && text.length > 0 ? text : null;
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
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
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
