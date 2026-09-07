#!/bin/zsh
# PHAROS-AGENT — one-shot setup and run (outside sandboxed bridges)
# Run:  /bin/zsh /Users/pharos_ai/pharos-agent/setup-run.sh
set -x
cd /Users/pharos_ai/pharos-agent || exit 1
export PATH="$HOME/.local/node/bin:/Users/pharos_ai/pharos-agent/pg/pgsql/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1

# 1. PostgreSQL (local socket only, port 5433)
if [ ! -f pgdata/PG_VERSION ]; then
  initdb -D pgdata -U pharos_ai --auth=trust -E UTF8 || exit 2
fi
if ! pg_ctl -D pgdata status >/dev/null 2>&1; then
  mkdir -p pgsock
  pg_ctl -D pgdata -l pg.log -o "-k /Users/pharos_ai/pharos-agent/pgsock -p 5433" start || exit 3
fi
sleep 2
createdb -h /Users/pharos_ai/pharos-agent/pgsock -p 5433 pharos_agent 2>/dev/null

# 2. Environment
cat > .env <<'ENVEOF'
DATABASE_URL="postgresql://pharos_ai@localhost:5433/pharos_agent?host=/Users/pharos_ai/pharos-agent/pgsock"
ENVEOF

# 3. Schema + Prisma client
npx prisma db push --skip-generate 2>&1 | tail -3
npx prisma generate 2>&1 | tail -2

# 4. Seed projects/grants/memory, then index registered document folders
npm run db:seed 2>&1 | tail -3
npm run ingest 2>&1 | tail -5

# 5. Start the control center (localhost only)
mkdir -p logs
if [ -f logs/dev.pid ] && kill -0 $(cat logs/dev.pid) 2>/dev/null; then
  kill $(cat logs/dev.pid) 2>/dev/null; sleep 2
fi
nohup npm run dev > logs/dev.log 2>&1 &
echo $! > logs/dev.pid
sleep 15
curl -s -o /dev/null -w "CONTROL_CENTER_HTTP_%{http_code}\n" http://localhost:3000/ || true
echo "SETUP_DONE" > setup.status
echo ""
echo "PHAROS-AGENT control center: http://localhost:3000"
