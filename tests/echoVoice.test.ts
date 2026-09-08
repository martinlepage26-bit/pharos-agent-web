import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  assertCanonicalVoice,
  jobIdFor,
  stripMarkdown,
  SpeakError,
  ECHO_REFERENCE,
  MAX_CHARS,
} from "@/tools/speakText";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ECHO is a single canonical voice", () => {
  it("points at the echosay reference, not a repo-local copy", () => {
    // The duplication this replaced: a second engine with its own
    // resampled copy of the same 22.13-second recording, so nothing in
    // the system knew the two were the same voice.
    expect(ECHO_REFERENCE).toContain(".local/share/echo-voice/reference.wav");
    expect(ECHO_REFERENCE).not.toContain("pharos-agent");
  });

  it("accepts the reference currently on disk", () => {
    expect(existsSync(ECHO_REFERENCE)).toBe(true);
    expect(() => assertCanonicalVoice()).not.toThrow();
  });

  it("is the 22.13-second recording, at the pinned digest", async () => {
    const buf = await fs.readFile(ECHO_REFERENCE);
    expect(createHash("sha256").update(buf).digest("hex")).toBe(
      "1367bb796d941ec4cf8d221b7e971be27ab14966394faa8e254dc6fb4c67c67c"
    );
    // 16-bit mono 22050 Hz → 44100 bytes per second. The header is not a
    // flat 44 bytes here (there are extra chunks), so this is a sanity
    // band around the 22.13s the WAV header itself reports, not a precise
    // duration — the digest above is what actually pins the file.
    expect(buf.byteLength / 44100).toBeCloseTo(22.13, 0);
  });
});

describe("the voice lock refuses rather than substitutes", () => {
  const tmp = path.join(process.env.TMPDIR ?? "/tmp", `echo-lock-${Date.now()}`);

  beforeAll(async () => {
    await fs.mkdir(tmp, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.PHAROS_ECHO_REFERENCE;
  });

  it("throws when the reference is missing", async () => {
    // Reload the module with the override in place, since the paths are
    // resolved once at import time. A fresh import is a distinct module
    // instance, so its SpeakError is a different class object than the
    // one imported at the top of this file — assert on the contract
    // (message and status), not on constructor identity.
    process.env.PHAROS_ECHO_REFERENCE = path.join(tmp, "absent.wav");
    const mod = await import(`@/tools/speakText?missing=${Date.now()}`);
    expect(() => mod.assertCanonicalVoice()).toThrow(/missing/i);
    try {
      mod.assertCanonicalVoice();
      expect.unreachable("should have refused");
    } catch (e) {
      expect((e as SpeakError).status).toBe(503);
    }
  });

  it("throws when the reference has been swapped for another clip", async () => {
    const impostor = path.join(tmp, "impostor.wav");
    await fs.writeFile(impostor, Buffer.alloc(2048, 7));
    process.env.PHAROS_ECHO_REFERENCE = impostor;
    const mod = await import(`@/tools/speakText?swapped=${Date.now()}`);
    // The failure mode this exists to prevent is silent substitution:
    // speaking on, in a voice that is no longer ECHO.
    expect(() => mod.assertCanonicalVoice()).toThrow(/changed/i);
  });
});

describe("clip identity and caching", () => {
  it("keys a clip by the digest of its text, so a repeat is free", () => {
    const a = jobIdFor("Echo speaking from the control center.");
    const b = jobIdFor("Echo speaking from the control center.");
    const c = jobIdFor("A different line entirely.");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("caps text to a time budget, not a length preference", () => {
    // ~0.85s of synthesis per character measured on this machine, so the
    // cap is what keeps a single utterance under about eight minutes.
    expect(MAX_CHARS).toBeLessThanOrEqual(600);
    const long = "word ".repeat(500);
    expect(stripMarkdown(long).slice(0, MAX_CHARS).length).toBe(MAX_CHARS);
  });
});
