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

- **Read-only retrieval** from explicitly registered folders (`~/pharos`, `~/pharos-suite`) — nothing else is *indexed*. Two routes additionally read a single fixed file each at request time: `/api/graph` (`~/pharos/state/graph.json`) and `/api/register` (`~/Documents/project-control.html`, served under a restrictive CSP).
- **Five typed tools**, each scoped, logged, and capability-gated: `search_project_documents`, `get_github_project_activity`, `get_calendar_agenda` (stub), `create_local_brief_draft`, `speak_text`.
- **Capability grants as application data** — enforced in code before every tool call, never in prompt wording. Scope checks fail closed.
- **Append-only audit ledger** — every run, tool call, retrieval, draft, and denial is inspectable in the UI, and enforced by a database trigger, not only by convention (`db/audit-append-only.sql`).
- **Curated memory** with provenance and confidence labels — no passive surveillance.
- **No inbound remote access**, no emails, no publishing, no merges, no shell execution. Note the one *outbound* path: when an OpenRouter key is present, retrieved excerpts and document paths are sent to that API for synthesis. Without a key nothing leaves the machine and the brief falls back to a deterministic template.

## Beyond the brief workflow

Three surfaces exist that the original v1 description did not cover:

- **`/graph`** — a canvas point-cloud of the vault, laid out deterministically from `~/pharos/state/graph.json` (`src/lib/graphLayout.ts`, `src/components/VaultOrb.tsx`).
- **`/register`** — the Project Control shared register, iframed live from `~/Documents/project-control.html` under a CSP whose `connect-src` excludes the agent's own origin.
- **Read-aloud** — `speak_text` sends brief text to a local F5-TTS engine (`pharos-voice/server.py`, loopback port 5434) and returns audio. Local inference; the reference clip never leaves the machine.

## Stack

Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL 17 (vendored
under `pg/`) · retrieval is **PostgreSQL full-text** (`ts_rank` + `ILIKE`);
pgvector is prepared in `db/extensions.sql` but not applied · optional
OpenRouter synthesis with deterministic template fallback.

## Setup (macOS)

```bash
# Everything below is what setup-run.sh already does on this machine.
# It uses the PostgreSQL vendored under pg/ on port 5433, not Homebrew.

# 1. Install dependencies
npm install

# 2. Schema. NOTE: this instance was built with `db push`, so there is no
#    migration history and no _prisma_migrations table. Do NOT run
#    `prisma migrate dev` against it — Prisma will see an unmanaged
#    database and offer to reset, which destroys the audit ledger.
npx prisma db push --skip-generate
npx prisma generate

# 3. Enforce the append-only ledger at the database level
npm run db:audit-lock

# 4. Seed projects, sources, grants, memory — then index documents
npm run db:seed
npm run ingest                  # add --force to rebuild every chunk

# 5. Run
npm run dev                     # http://127.0.0.1:3000
```

Optional: set `OPENROUTER_API_KEY` (or rely on the PHAROS key file at
`~/pharos/state/openrouter.key`) and `GITHUB_TOKEN` for richer briefs.
Without them everything still works, the brief falls back to a
deterministic cited template, and nothing is sent off the machine.

On this Mac both services run under launchd — `ca.pharos.agent` (the
control center) and `ca.pharos.voice` (the F5-TTS engine).

## CLI

```bash
npm run brief -- --project pharos --language fr-CA
npm run ingest -- --force       # rebuild the index from scratch
```

## Layout

```
src/app/          Next.js UI + API routes (dashboard, briefs, runs, sources,
                  search, graph, register, speak)
src/components/   VaultOrb, GraphView/Stage, ReadAloudButton, Nav, Clock
src/lib/          prisma client, policy engine, audit ledger, brief workflow,
                  model client, graph layout
src/tools/        the five typed tools + registry
scripts/          seed, ingest, brief CLI
prisma/           schema (governance-first data model)
db/               audit-append-only.sql (applied) · extensions.sql (pgvector,
                  prepared but not applied)
docs/             PHAROS-AGENT-CONTRACT.md — the normative contract
pharos-voice/     local F5-TTS engine (separate Python service, loopback 5434)
drafts/           the only location the agent writes to (gitignored)
```

The provisioning scripts (`setup-run.sh`, `pa-dev.sh`) also write `.env`
if absent, `logs/`, `setup.status`, and the Postgres cluster in `pgdata/`.
`drafts/` is the only path the *agent* writes to.

## Upgrade path

1. **pgvector embeddings** — column and index are prepared in `db/extensions.sql`; swap FTS ranking for hybrid semantic search.
2. **EventKit calendar adapter** (read-only) replacing the honest stub.
3. **GitHub read integration** once `GITHUB_TOKEN` is set. Note the scope is *not* yet enforced by the policy engine: the grant's `repositoryIds` is empty and no caller passes a `repositoryId`, so today the restriction comes from the tool's own query. Populate the grant and pass the id before relying on it.
4. **Scheduled morning brief** via launchd (`~/pharos/launchd/` pattern).
5. **Approval queue** for reversible writes (draft GitHub issues, local tasks) — never for send/publish/merge/delete.
6. **Memory lifecycle in the UI** — the contract (§4) promises memory items are editable, expirable and deletable; today `/sources` renders them read-only and the schema has no expiry field.
7. **Migration history** — the schema exists only as `prisma/schema.prisma` plus the live cluster. Baseline it before the schema needs to change on another machine.

## Principles

The agent can **observe broadly within chosen workspaces, reason
transparently, draft aggressively, and act narrowly.** Every capability it
has is a row in the database you can inspect, scope, and revoke.
