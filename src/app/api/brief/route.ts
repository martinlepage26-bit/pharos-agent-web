import { NextResponse } from "next/server";
import { runBriefWorkflow, type BriefLanguage } from "@/lib/brief";

export async function POST(request: Request) {
  const form = await request.formData();
  const projectKey = String(form.get("projectKey") ?? "");
  const language = String(form.get("language") ?? "fr-CA") as BriefLanguage;

  if (!projectKey) {
    return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
  }
  if (!["fr-CA", "en-CA", "bilingual"].includes(language)) {
    return NextResponse.json({ error: "invalid language" }, { status: 400 });
  }

  try {
    const result = await runBriefWorkflow({ projectKey, language });
    return NextResponse.redirect(
      new URL(`/briefs/${result.briefId}`, request.url),
      303
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "workflow failed" },
      { status: 500 }
    );
  }
}
