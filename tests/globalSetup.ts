import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Build a throwaway database for the suite.
 *
 * Tests must never run against pharos_agent: the audit ledger there is
 * append-only by database trigger, so a test that writes a row could not
 * clean up after itself, and the real ledger would fill with fixtures.
 * The test database is dropped and rebuilt from migrations on every run,
 * which also means the migration history is exercised on every run.
 */
const REPO = path.resolve(__dirname, "..");
const PG_BIN = path.join(REPO, "pg/pgsql/bin");
const SOCKET = path.join(REPO, "pgsock");
const PORT = "5433";
const DB = "pharos_agent_test";

export const TEST_DATABASE_URL = `postgresql://pharos_ai@localhost:${PORT}/${DB}?host=${SOCKET}`;

function psql(args: string[], db = "postgres") {
  return execFileSync(path.join(PG_BIN, "psql"), [
    "-h", SOCKET, "-p", PORT, "-d", db, "-v", "ON_ERROR_STOP=1", "-q",
    ...args,
  ], { encoding: "utf8" });
}

export default function setup() {
  // Terminate stragglers first; DROP DATABASE fails while anything is
  // still connected, and a crashed previous run leaves connections open.
  psql(["-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();`]);
  psql(["-c", `DROP DATABASE IF EXISTS ${DB};`]);
  psql(["-c", `CREATE DATABASE ${DB};`]);

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
