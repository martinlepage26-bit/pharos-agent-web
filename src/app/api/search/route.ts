import { searchProjectDocuments } from "@/tools/searchProjectDocuments";
import { NextResponse } from "next/server";

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
    const output = await searchProjectDocuments({
      projectKey: body.projectKey,
      query: body.query,
      limit: body.limit,
    });
    return NextResponse.json(output);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 403 }
    );
  }
}
