import { NextResponse } from "next/server";
import { CapabilityDenied } from "@/lib/policy";
import { runSearch } from "@/lib/searchRun";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    projectKey?: string;
    query?: string;
    limit?: number;
  } | null;

  if (!body?.projectKey || !body?.query) {
    return NextResponse.json(
      { error: "projectKey and query are required" },
      { status: 400 }
    );
  }

  try {
    const { output, runId } = await runSearch({
      projectKey: body.projectKey,
      query: body.query,
      limit: body.limit,
      origin: "POST /api/search",
    });
    return NextResponse.json({ ...output, runId });
  } catch (err) {
    // 403 only for an actual denial. Every exception used to return 403,
    // so a dead database or a Prisma error told the caller their
    // capability had been revoked and sent them off debugging grants.
    if (err instanceof CapabilityDenied) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 500 }
    );
  }
}
