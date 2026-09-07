import { prisma } from "./prisma";
import { callTool } from "../tools/registry";
import type { SearchOutput } from "../tools/searchProjectDocuments";

/**
 * Run an ad-hoc search as a first-class agent run.
 *
 * Both search entry points — the API route and the search page — used to
 * call the tool function directly. The capability check still fired, but
 * the call produced no ToolCall row and its audit event carried a null
 * runId, so it appeared on no run page. A *denied* search was the worst
 * case: it recorded a capability_denied nobody could trace back to a run,
 * visible only until it scrolled off the dashboard feed.
 *
 * Going through callTool with a real run costs one AgentRun per search.
 * That is the price of the contract's promise that every tool call
 * records a run id.
 */
export async function runSearch(input: {
  projectKey: string;
  query: string;
  limit?: number;
  origin: string;
}): Promise<{ output: SearchOutput; runId: string }> {
  const run = await prisma.agentRun.create({
    data: {
      goal: `Search ${input.projectKey}: ${input.query.slice(0, 80)}`,
      status: "running",
    },
  });

  try {
    const output = (await callTool(
      run.id,
      "search_project_documents",
      { projectKey: input.projectKey, query: input.query, limit: input.limit },
      `ad-hoc search from ${input.origin}`
    )) as SearchOutput;

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "completed", finishedAt: new Date() },
    });
    return { output, runId: run.id };
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date() },
    });
    throw err;
  }
}
