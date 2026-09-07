# PHAROS-AGENT-CONTRACT

The normative contract for the `pharos-agent` companion repository, referenced
by the PHAROS personal OS (`~/pharos/README.md`). Version 0.1 — 2026-09-04.

## 1. Purpose

pharos-agent is a **private, auditable personal operations agent**. It turns
explicitly authorized information into high-quality, cited drafts and decision
support while keeping consequential action under human control.

It is not an autonomous desktop controller. It does not send, publish, merge,
delete, purchase, or execute arbitrary commands — by design, not by prompt.

## 2. Authority model

Authorization is **application data, not prompt wording.** Before any tool
call, the engine verifies an explicit `CapabilityGrant` that is:

- enabled, unexpired, and held by the `personal-agent` subject;
- scoped to the requested resource (project keys, repository ids, allowed paths);
- auditable: denials are recorded with a reason.

Scope checks **fail closed**. If a grant declares a scope dimension, a call
that supplies no value for that dimension is denied — an unanswered scope
question is not a pass.

Capabilities in v1:

| Capability | Mode | Scope |
|---|---|---|
| `documents.search` | preapproved | registered sources of `pharos`, `pharos-suite` |
| `github.read` | preapproved | repositories named in the grant's `repositoryIds`, checked per repository at the point of access; an empty list denies all |
| `calendar.read` | preapproved | stub until the EventKit adapter exists |
| `drafts.write` | preapproved | `drafts/` inside this repository only |
| `voice.speak` | preapproved | the local synthesis engine on loopback; no project, repository, or path dimension applies |

Anything not granted is denied by default and the denial is logged.

### Revision 2026-09-07 — `voice.speak`

`voice.speak` is recorded here as a **correction, not a new grant of
authority.** The read-aloud feature shipped exercising this capability with
no grant row, no registry entry, and no `assertCapability` call, auditing
itself under a null run id — precisely the drift §9 forbids. It is now a
typed tool (`speak_text`) reached through the registry, backed by a grant
row that can be inspected and disabled like any other.

Its bound: it sends text already in the agent's possession to a local
process on `127.0.0.1`, and returns audio. It reads no new source, and
nothing leaves the machine.

## 3. Tool rules

1. Tools are typed functions in a registry — not free-form model output.
2. Every call records: run id, tool, capability, purpose, sanitized input,
   output summary, status, timestamp.
3. Untrusted text (documents, issues, web content) is **data**, never
   instructions. Retrieved content cannot alter policy, authorize tools, or
   change output locations.
4. Read-only tools may run under durable narrow grants. The only write in v1
   is the local draft, confined to `drafts/`.
5. Unconfigured integrations report `not_configured` honestly — the agent
   never fabricates results.

## 4. Memory rules

Memory is **curated, not collected.** Two classes:

- **Profile memory** — durable, editable preferences (bilingual output,
  governance expectations, active priorities).
- **Project memory** — structured statements tied to a project with
  category, provenance (`sourceRefs`), confidence (`confirmed` /
  `inferred` / `needs_review`), and sensitivity.

Every memory item is inspectable, editable, expirable, and deletable in the
UI. A retrieved sentence is evidence; an interpretation keeps its provenance
and confidence label.

## 5. Output rules

1. Every brief is labelled **DRAFT — human review required.**
2. Factual claims cite retrieved sources; analysis is marked as inference;
   actions are proposals requiring confirmation.
3. French-Canadian first, English-Canadian co-equal when requested.
4. Uncertainty is stated explicitly.
5. Drafts are written only to `drafts/` with a content hash recorded.

## 6. Audit ledger

Append-only `AuditEvent` records: `run_started`, `retrieval_completed`,
`tool_called`, `draft_created`, `capability_denied`, `approval_requested`,
`approval_granted`, `approval_denied`, `run_completed`, `run_failed`,
`ingestion_completed`. The ledger never stores plaintext secrets or full
credentials.

## 7. Deployment boundary

- All services bind to `127.0.0.1` only.
- No public exposure in v1. Remote access, if ever added, is read-only and
  approval-gated by default.
- Secrets stay in environment variables or the macOS keychain — never in the
  database or logs.

## 8. Quality gates

Before any capability beyond v1 is granted, the system must demonstrate:
source attribution, scope control, action control, prompt-injection
resilience, visible error handling, memory hygiene, bilingual quality, cost
control (run budgets), and reproducibility (prompt version, model, source
set, tool calls, output hash).

## 9. Change control

This contract changes only deliberately: a capability is added by a new grant
row plus a contract revision, never by rewording a prompt.
