#!/bin/bash
# Usage: deploy.sh prod|staging — pull, build, back up, migrate, reload, health-check. Idempotent.
set -euo pipefail
INSTANCE="${1:?usage: deploy.sh prod|staging}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
BRANCH=$([ "$INSTANCE" = prod ] && echo main || echo dev)
PORT=$([ "$INSTANCE" = prod ] && echo 3060 || echo 3061)
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/boogbe-$INSTANCE}"
export BOOGBE_INSTANCE="$INSTANCE"

# Read .env without sourcing it: values may contain characters the shell would interpret.
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
MIGRATE_URL="$(env_get DATABASE_MIGRATE_URL)"
[ -n "$MIGRATE_URL" ] || { echo "DATABASE_MIGRATE_URL missing in .env"; exit 1; }

echo "→ pull $BRANCH"; git fetch --quiet origin "$BRANCH"; git checkout --quiet "$BRANCH"; git reset --hard --quiet "origin/$BRANCH"
echo "→ install"; pnpm install --frozen-lockfile
echo "→ prisma generate"; pnpm --filter @boogbe/api prisma:generate
# "@boogbe/api..." also builds its workspace dependencies: the compiled API requires @boogbe/shared/dist.
echo "→ build api"; NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter "@boogbe/api..." build

echo "→ backup"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
PG_URL="${MIGRATE_URL%%\?*}"
if ! pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_FILE" "$PG_URL"; then
  echo "✗ backup failed — aborting before migrations"; rm -f "$BACKUP_FILE"; exit 1
fi
[ -s "$BACKUP_FILE" ] || { echo "✗ empty backup — aborting"; rm -f "$BACKUP_FILE"; exit 1; }
find "$BACKUP_DIR" -name 'pre-deploy-*.dump' -mtime +14 -delete || true

echo "→ migrate"; DATABASE_URL="$MIGRATE_URL" pnpm --filter @boogbe/api prisma:migrate:deploy

echo "→ reload"
mkdir -p logs
# A process registered from another checkout path would keep running old code after reload.
for p in api worker; do
  NAME="boogbe-$INSTANCE-$p"
  EXPECTED="$DIR/apps/api/dist/$([ $p = api ] && echo main || echo worker).js"
  RUNNING="$(pm2 jlist 2>/dev/null | node -e "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{try{const a=JSON.parse(r).find(x=>x.name==='$NAME');process.stdout.write(a?.pm2_env?.pm_exec_path??'')}catch{}})" || true)"
  if [ -n "$RUNNING" ] && [ "$RUNNING" != "$EXPECTED" ]; then pm2 delete "$NAME" || true; fi
done
pm2 startOrReload ecosystem.config.js --env production
pm2 save

echo "→ health"
for _ in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:$PORT/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "✓ healthy"; exit 0
  fi
  sleep 2
done
echo "✗ API did not become healthy"; pm2 logs "boogbe-$INSTANCE-api" --lines 50 --nostream; exit 1
