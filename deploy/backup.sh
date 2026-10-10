#!/bin/bash
# Usage: backup.sh prod|staging — pg_dump (custom format) to R2, keep 30 days.
set -euo pipefail
INSTANCE="${1:?usage: backup.sh prod|staging}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
URL="$(env_get DATABASE_MIGRATE_URL)"; URL="${URL%%\?*}"
AWS_ACCESS_KEY_ID="$(env_get R2_ACCESS_KEY_ID)"; AWS_SECRET_ACCESS_KEY="$(env_get R2_SECRET_ACCESS_KEY)"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
ENDPOINT="$(env_get R2_ENDPOINT)"; BUCKET="$(env_get R2_BUCKET)"
TS=$(date -u +%Y%m%dT%H%M%SZ); KEY="backups/$INSTANCE/$(date -u +%Y/%m/%d)/boogbe-$TS.dump"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$TMP" "$URL"
[ -s "$TMP" ] || { echo "empty dump"; exit 1; }
aws s3 cp "$TMP" "s3://$BUCKET/$KEY" --endpoint-url "$ENDPOINT" --only-show-errors
CUTOFF=$(date -u -d '30 days ago' +%Y-%m-%d)
aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "backups/$INSTANCE/" --endpoint-url "$ENDPOINT" \
  --query "Contents[?LastModified<'$CUTOFF'].Key" --output text \
  | tr '\t' '\n' | grep -v '^None$' | while read -r k; do
      [ -n "$k" ] && aws s3 rm "s3://$BUCKET/$k" --endpoint-url "$ENDPOINT" --only-show-errors
    done
echo "backup ok: $KEY"
