import { NextResponse } from "next/server";
import { runBriefWorkflow, isBriefLanguage } from "@/lib/brief";

/**
 * Reject cross-site form posts.
 *
 * This route accepts application/x-www-form-urlencoded, which is a CORS
 * "simple request": no preflight, so any page the user visits could POST
 * here and start a run. Localhost-only is a network boundary, not a
 * browser one. Browsers always send Origin on POST; a missing Origin
 * means a non-browser client (curl, the CLI), which is allowed.
 */
function isCrossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  // Compare against the Host header the browser actually addressed, not
  // request.url — behind Next's server those can differ (localhost vs
  // 127.0.0.1), which would reject the app's own form.
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

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
