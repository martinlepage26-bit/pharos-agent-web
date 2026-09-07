import { describe, it, expect } from "vitest";
import { slugSegment } from "@/lib/models";
import { isBriefLanguage, BRIEF_LANGUAGES, DRAFT_LABEL, ensureDraftLabel } from "@/lib/brief";
import { isCrossSite } from "@/lib/sameOrigin";
import { stripMarkdown } from "@/tools/speakText";

describe("slugSegment — the filename sanitiser", () => {
  it("flattens every path separator and dot sequence", () => {
    // These are the payloads that escaped drafts/ before the write path
    // was confined. None may survive as a separator.
    for (const hostile of [
      "../../../../tmp/pwned",
      "../../../.zshenv",
      "fr-CA/../../../../../../tmp/pwned2",
      "..%2F..%2Ftmp%2Fpwned3",
      "a/b\\c",
      "...",
    ]) {
      const out = slugSegment(hostile, "fallback");
      expect(out).not.toMatch(/[/\\]/);
      expect(out).not.toContain("..");
      expect(out).toMatch(/^[a-zA-Z0-9-]+$/);
    }
  });

  it("falls back rather than returning an empty segment", () => {
    expect(slugSegment("", "brief")).toBe("brief");
    expect(slugSegment("///", "brief")).toBe("brief");
    expect(slugSegment("---", "brief")).toBe("brief");
  });

  it("preserves case only when asked, so fr-CA stays fr-CA", () => {
    expect(slugSegment("fr-CA", "x")).toBe("fr-ca");
    expect(slugSegment("fr-CA", "x", { preserveCase: true })).toBe("fr-CA");
  });
});

describe("brief language whitelist", () => {
  it("accepts exactly the three declared languages", () => {
    for (const l of BRIEF_LANGUAGES) expect(isBriefLanguage(l)).toBe(true);
  });

  it("rejects the traversal payload the CLI used to cast blindly", () => {
    for (const bad of ["../../../../tmp/pwned", "fr", "", "FR-CA", "en_CA"]) {
      expect(isBriefLanguage(bad)).toBe(false);
    }
  });
});

describe("isCrossSite", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/brief", { method: "POST", headers });

  it("allows the app's own form even when Host and request.url differ", () => {
    // The reason Origin is compared to Host and not to request.url.
    expect(isCrossSite(req({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("allows non-browser clients, which send no Origin", () => {
    expect(isCrossSite(req({ host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("blocks a hostile page", () => {
    expect(isCrossSite(req({ origin: "https://evil.example", host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("blocks on Sec-Fetch-Site regardless of Origin", () => {
    expect(isCrossSite(req({ "sec-fetch-site": "cross-site", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isCrossSite(req({ "sec-fetch-site": "same-site", host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("blocks a malformed Origin rather than failing open", () => {
    expect(isCrossSite(req({ origin: "not-a-url", host: "127.0.0.1:3000" }))).toBe(true);
  });
});

describe("stripMarkdown", () => {
  it("removes markup the voice would otherwise read aloud", () => {
    const out = stripMarkdown("# Title\n\n- **bold** item\n\n`code`\n\n| a | b |");
    expect(out).not.toMatch(/[#*`|]/);
    expect(out).toContain("Title");
    expect(out).toContain("bold");
  });
});

describe("DRAFT label", () => {
  it("is the exact string the contract names", () => {
    expect(DRAFT_LABEL).toBe("DRAFT — human review required");
  });

  it("appends the label to a response that omits it", () => {
    // The failure this guards: on the synthesis path the label was only
    // ever requested in the prompt, so a truncated or non-compliant model
    // response produced an unlabelled brief. The template path always
    // carried the label, which is why a whole-workflow test run offline
    // cannot see this — it has to be checked directly.
    const truncated = "# Brief\n\n## 1. Priorities\n- something\n\n## 2. Open decisi";
    const out = ensureDraftLabel(truncated);
    expect(out).toContain(DRAFT_LABEL);
    expect(out.trimEnd().endsWith(DRAFT_LABEL)).toBe(true);
  });

  it("leaves a compliant response untouched and does not double-label", () => {
    const compliant = `# Brief\n\ncontent\n\n---\n${DRAFT_LABEL}\n`;
    expect(ensureDraftLabel(compliant)).toBe(compliant);
    const twice = ensureDraftLabel(ensureDraftLabel("no label here"));
    expect(twice.split(DRAFT_LABEL)).toHaveLength(2);
  });
});
