# PHAROS·AGENT

The companion control-center agent for [PHAROS](../pharos) — the governed,
database-backed layer that turns explicitly authorized information into cited
briefs and decision support, while keeping consequential action under human
control.

The normative contract is [`docs/PHAROS-AGENT-CONTRACT.md`](docs/PHAROS-AGENT-CONTRACT.md).

## What v1 does

One bounded, testable workflow:

> Retrieve from registered sources → synthesize a cited work brief
> (Canadian French first, English co-equal) → save as a local draft.

- **Read-only retrieval** from explicitly registered folders (`~/pharos`, `~/pharos-suite`) — nothing else on disk is indexed.
- **Four typed tools**, each scoped, logged, and capability-gated: `search_project_documents`, `get_github_project_activity`, `get_calendar_agenda` (stub), `create_local_brief_draft`.
- **Capability grants as application data** — enforced in code before every tool call, never in prompt wording.
- **Append-only audit ledger** — every run, tool call, retrieval, draft, and denial is inspectable in the UI.
- **Curated memory** with provenance and confidence labels — no passive surveillance.
- **Localhost only.** No remote access, no emails, no publishing, no merges, no shell execution.

## Stack

Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL 16 + pgvector
(FTS now, vector-ready) · optional OpenRouter synthesis with deterministic
template fallback.

## Setup (macOS)

```bash
# 1. PostgreSQL + pgvector (once)
brew install postgresql@16 pgvector
brew services start postgresql@16
createdb pharos_agent

# 2. Install dependencies
npm install

# 3. Migrate + optional pgvector column
npx prisma migrate dev --name init
npm run db:extensions || true   # best-effort; FTS works without it

# 4. Seed projects, sources, grants, memory — then index documents
npm run db:seed
npm run ingest

# 5. Run
npm run dev                     # http://localhost:3000
```

Optional: set `OPENROUTER_API_KEY` (or rely on the PHAROS key file) and
`GITHUB_TOKEN` for richer briefs. Without them, everything still works —
the brief falls back to a deterministic, fully-cited template.

## CLI

```bash
npm run brief -- --project pharos --language fr-CA
```

## Layout

```
src/app/          Next.js UI + API routes (dashboard, briefs, runs, sources, search)
src/lib/          prisma client, policy engine, audit ledger, brief workflow, model client
src/tools/        the four typed tools + registry
scripts/          seed, ingest, brief CLI
prisma/           schema (governance-first data model)
db/               optional pgvector enablement SQL
docs/             PHAROS-AGENT-CONTRACT.md — the normative contract
drafts/           the ONLY writable output location (gitignored)
```

## Upgrade path

1. **pgvector embeddings** — column and index are prepared in `db/extensions.sql`; swap FTS ranking for hybrid semantic search.
2. **EventKit calendar adapter** (read-only) replacing the honest stub.
3. **GitHub read integration** once `GITHUB_TOKEN` is set — already scoped to registered repos.
4. **Scheduled morning brief** via launchd (`~/pharos/launchd/` pattern).
5. **Approval queue** for reversible writes (draft GitHub issues, local tasks) — never for send/publish/merge/delete.

## Principles

The agent can **observe broadly within chosen workspaces, reason
transparently, draft aggressively, and act narrowly.** Every capability it
has is a row in the database you can inspect, scope, and revoke.
