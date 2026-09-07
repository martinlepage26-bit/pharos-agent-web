-- Make the append-only audit ledger append-only in the database, not
-- only by convention in src/lib/audit.ts.
--
-- The contract (§6) and the dashboard badge both assert the AuditEvent
-- ledger is append-only. In code that held: audit.ts exposes a single
-- create() and nothing anywhere issues an update or delete against the
-- table. But nothing *prevented* it either — no triggers, no RLS, and the
-- application connects as the database owner, so REVOKE would not bind
-- (owners bypass table privileges). A single prisma.agentRun.delete()
-- would have cascaded into the ledger via AuditEvent.runId's SetNull and
-- rewritten rows in place.
--
-- A BEFORE trigger binds the owner too, which is why it is used here.
--
-- Consequence worth knowing: deleting an AgentRun now fails, because the
-- SetNull on AuditEvent.runId is an UPDATE. That is the intended meaning
-- of an append-only ledger — a run and its audit trail are not erasable.
-- To prune the ledger deliberately, drop the trigger, prune, recreate it.
--
-- Apply with:  npm run db:audit-lock

CREATE OR REPLACE FUNCTION pharos_audit_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'AuditEvent is append-only: % is not permitted (see db/audit-append-only.sql)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION pharos_audit_append_only();

-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level one.
DROP TRIGGER IF EXISTS audit_event_no_truncate ON "AuditEvent";

CREATE TRIGGER audit_event_no_truncate
BEFORE TRUNCATE ON "AuditEvent"
FOR EACH STATEMENT EXECUTE FUNCTION pharos_audit_append_only();
