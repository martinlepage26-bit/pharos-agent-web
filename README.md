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

# 2. Schema. Migration history was baselined on 2026-09-07 from the
#    live cluster (0_init), plus 1_audit_append_only for the ledger
#    triggers. On a fresh machine `migrate deploy` builds both.
npx prisma migrate deploy
npx prisma generate

#    On THIS machine the schema is already applied and marked. Never run
#    `prisma migrate reset` here — it drops the audit ledger.

# 3. Seed projects, sources, grants, memory — then index documents
npm run db:seed
npm run ingest                  # add --force to rebuild every chunk

# 4. Run
npm run dev                     # http://127.0.0.1:3000
```

Optional: set `OPENROUTER_API_KEY` (or rely on the PHAROS key file at
`~/pharos/state/openrouter.key`) and `GITHUB_TOKEN` for richer briefs.
Without them everything still works, the brief falls back to a
deterministic cited template, and nothing is sent off the machine.

On this Mac both services run under launchd — `ca.pharos.agent` (the
control center) and `ca.pharos.voice` (the F5-TTS engine).

⚠️ `npm run build` and `next dev` share `.next/`, so building while the
launchd dev server is up leaves it serving a half-replaced tree and pages
start returning 500. Restart it afterwards:

```bash
launchctl kickstart -k gui/$(id -u)/ca.pharos.agent
```

## CLI

```bash
npm run brief -- --project pharos --language fr-CA
npm run ingest -- --force       # rebuild the index from scratch
```

## Tests

```bash
npm test                        # vitest run
npm run test:watch
```

61 tests covering the governance invariants: draft-path containment,
fail-closed scope checks, per-repository allowlisting, the append-only
ledger triggers, retrieval semantics and limit clamping, ingestion
freshness, expired-memory exclusion, and the DRAFT label on both the
template and synthesis paths.

`tests/registryGating.test.ts` iterates `TOOL_REGISTRY` itself, so a tool
added without an `assertCapability` line fails the moment it is
registered — which is how `voice.speak` escaped the authority model in
the first place. It also pins the set of declared capabilities to the
five in the contract.

The suite builds and drops its own database (`pharos_agent_test`) from
migrations on every run, so it never touches `pharos_agent` — whose
ledger is append-only and could not be cleaned up afterwards anyway. It
runs with no model key, so nothing reaches the network; the one test that
needs the synthesis path mocks the model.

Worth knowing when adding tests: several invariants cannot be caught by a
whole-workflow assertion, because the offline template path masks them.
The DRAFT label is the example — the template appends it regardless, so
only `tests/synthesisPath.test.ts` can see it go missing. Check a new
test actually fails when you break the thing it claims to cover.

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

## Known dependency advisories

`npm audit` reports 5 vulnerabilities (4 high, 1 moderate). Both roots
were checked as of 2026-09-07 and neither has a fix that `npm audit fix`
can apply, despite what it says:

- **deepmerge-ts <8.0.0**, via `prisma → @prisma/config`. There is no
  Prisma version that resolves this — `@prisma/config@latest` still pins
  `deepmerge-ts@7.1.5`. Waiting on upstream.
- **postcss ≤8.5.22**, via `next@15.5.25`, which pins `8.4.31`. The fix
  first appears in Next 16, a major upgrade with breaking changes; 15.5.25
  is the newest 15.x. (The other `postcss` in the tree, `8.5.28` under
  vitest, is already unaffected.)

Both are build-time dependencies. Neither is reachable from a request to
this localhost-only app, and neither parses untrusted input here. Revisit
when Prisma updates, or when a Next 16 migration is worth doing on its
own merits.

## Upgrade path

1. **pgvector embeddings** — column and index are prepared in `db/extensions.sql`; swap FTS ranking for hybrid semantic search.
2. **EventKit calendar adapter** (read-only) replacing the honest stub.
3. **GitHub read integration** once `GITHUB_TOKEN` is set. Registering a `github_repo` source is not sufficient: the repository's full name must also appear in the `github.read` grant's `repositoryIds`, which is checked per repository at the point of access. An empty list denies all.
4. **Scheduled morning brief** via launchd (`~/pharos/launchd/` pattern).
5. **Approval queue** for reversible writes (draft GitHub issues, local tasks) — never for send/publish/merge/delete.
6. **Memory lifecycle in the UI** — the contract (§4) promises memory items are editable, expirable and deletable; today `/sources` renders them read-only and the schema has no expiry field.
7. **pgvector, for real** — `db/extensions.sql` is still unapplied and the `Chunk.embedding` column does not exist. If it is ever applied, add it as a migration so the two stay in step.

## Principles

The agent can **observe broadly within chosen workspaces, reason
transparently, draft aggressively, and act narrowly.** Every capability it
has is a row in the database you can inspect, scope, and revoke.
