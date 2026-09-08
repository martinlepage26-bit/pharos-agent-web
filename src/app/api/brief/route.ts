import { NextResponse } from "next/server";
import { runBriefWorkflow, isBriefLanguage } from "@/lib/brief";
import { isCrossSite, sameOriginRedirect } from "@/lib/sameOrigin";

export async function POST(request: Request) {
  if (isCrossSite(request)) {
    return NextResponse.json(
      { error: "cross-site requests are not accepted" },
      { status: 403 }
    );
  }

  // formData() throws on a wrong or missing Content-Type. It used to sit
  // outside the try, so those requests bypassed this route's error shape
  // entirely and surfaced as an opaque 500 (five such TypeErrors are in
  // logs/dev.err).
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error:
          "expected multipart/form-data or application/x-www-form-urlencoded",
      },
      { status: 415 }
    );
  }

  const projectKey = String(form.get("projectKey") ?? "");
  const language = String(form.get("language") ?? "fr-CA");

  if (!projectKey) {
    return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
  }
  if (!isBriefLanguage(language)) {
    return NextResponse.json({ error: "invalid language" }, { status: 400 });
  }

  // A browser posting the dashboard form wants to land on the brief; a
  // program wants the ids. URLSession follows redirects by default, so a
  // non-browser client that got the 303 would receive the HTML of the
  // brief page and lose the id it came for.
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

  try {
    const result = await runBriefWorkflow({ projectKey, language });
    if (wantsJson) {
      return NextResponse.json({
        briefId: result.briefId,
        runId: result.runId,
        filePath: result.filePath,
      });
    }
    return NextResponse.redirect(
      sameOriginRedirect(request, `/briefs/${result.briefId}`),
      303
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "workflow failed" },
      { status: 500 }
    );
  }
}
