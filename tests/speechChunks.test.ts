import { describe, it, expect } from "vitest";
import {
  splitForSpeech,
  planChunks,
  digestOf,
  CHUNK_TARGET_CHARS,
} from "@/lib/speechChunks";

const LONG_SENTENCE =
  "A decision was taken in June and stands, though one blocker remains on the calendar adapter, and nothing else of consequence happened this week";

describe("splitForSpeech", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("   \n  ")).toEqual([]);
  });

  it("keeps a short passage in one piece", () => {
    expect(splitForSpeech("Short enough to say in one breath.")).toEqual([
      "Short enough to say in one breath.",
    ]);
  });

  it("never exceeds the target, except for a single unbreakable word", () => {
    const text =
      "The lighthouse keeps its own hours. The harbour answers to nobody tonight. " +
      LONG_SENTENCE +
      ". One more sentence to be sure the packing loop terminates cleanly.";
    for (const c of splitForSpeech(text)) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
    }
  });

  it("prefers sentence boundaries over clause or width", () => {
    const out = splitForSpeech("First sentence here. Second sentence here.", 80);
    // Both fit in one chunk, and the join must not lose the full stop.
    expect(out.join(" ")).toContain("First sentence here.");
    expect(out.join(" ")).toContain("Second sentence here.");
  });

  it("breaks an over-long sentence at clauses, not mid-clause", () => {
    const out = splitForSpeech(LONG_SENTENCE, 60);
    expect(out.length).toBeGreaterThan(1);
    // Every piece except the last should end where a clause ended.
    for (const piece of out.slice(0, -1)) {
      expect(piece).toMatch(/[,;:—]$/);
    }
  });

  it("loses no words", () => {
    const text =
      "The lighthouse keeps its own hours. " + LONG_SENTENCE + ". Nothing else happened.";
    const words = (s: string) => s.split(/\s+/).filter(Boolean);
    expect(words(splitForSpeech(text).join(" "))).toEqual(words(text.replace(/\s+/g, " ").trim()));
  });

  it("handles a single word longer than the cap without slicing every word", () => {
    const out = splitForSpeech("a".repeat(200), 80);
    expect(out.join("")).toBe("a".repeat(200));
    expect(out.every((c) => c.length <= 80)).toBe(true);
  });

  it("is deterministic — the cache depends on it", () => {
    const text = "The lighthouse keeps its own hours. " + LONG_SENTENCE + ".";
    expect(splitForSpeech(text)).toEqual(splitForSpeech(text));
    expect(planChunks(text).map((c) => c.id)).toEqual(planChunks(text).map((c) => c.id));
  });
});

describe("chunk addressing", () => {
  it("keys a chunk by the digest of its own text", () => {
    const chunks = planChunks("First sentence here. " + LONG_SENTENCE + ".");
    for (const c of chunks) {
      expect(c.id).toBe(digestOf(c.text));
      expect(c.chars).toBe(c.text.length);
      expect(c.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("re-renders only the chunk that changed", () => {
    // The economy that makes an engine this slow tolerable: edit one
    // sentence of a brief and the rest replay from cache.
    const before = planChunks("Alpha sentence one. Beta sentence two. Gamma sentence three.", 24);
    const after = planChunks("Alpha sentence one. Beta sentence TWO. Gamma sentence three.", 24);
    const unchanged = after.filter((c) => before.some((b) => b.id === c.id));
    expect(unchanged.length).toBe(after.length - 1);
  });
});
