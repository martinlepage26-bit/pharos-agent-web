#!/bin/zsh
# PHAROS-AGENT control center — launchd wrapper (keeps dev server alive)
export PATH="$HOME/.local/node/bin:/Users/pharos_ai/pharos-agent/pg/pgsql/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
cd /Users/pharos_ai/pharos-agent || exit 1
mkdir -p logs

# Ensure PostgreSQL is up (local socket, port 5433)
if ! pg_ctl -D pgdata status >/dev/null 2>&1; then
  mkdir -p pgsock
  pg_ctl -D pgdata -l pg.log -o "-k /Users/pharos_ai/pharos-agent/pgsock -p 5433" start || true
  sleep 2
  createdb -h /Users/pharos_ai/pharos-agent/pgsock -p 5433 pharos_agent 2>/dev/null || true
fi

# Kill any stale dev server, then run (foreground; launchd supervises)
if [ -f logs/dev.pid ] && kill -0 $(cat logs/dev.pid) 2>/dev/null; then
  kill $(cat logs/dev.pid) 2>/dev/null
  sleep 2
fi
exec npm run dev
