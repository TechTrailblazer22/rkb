#!/usr/bin/env bash
# Takes a full backup of the database into a file you can keep, and (with --drill) proves it can be
# restored by restoring it into a throwaway database and comparing row counts.
#
#   DIRECT_URL=postgresql://user:pass@host/db ./scripts/backup.sh [--drill]
#
# Needs pg_dump, pg_restore and psql (the PostgreSQL client tools). DIRECT_URL is the direct, not the
# pooled, connection (on Neon, the one without "-pooler"). For the drill, DRILL_ADMIN_URL must point to
# a server where a database named rkb_restore_drill may be created and dropped (never your live one).
# See docs/OPERATIONS.md.
set -euo pipefail

: "${DIRECT_URL:?Set DIRECT_URL to the database's direct connection string}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="rkb-backup-${STAMP}.dump"

pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DIRECT_URL"
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

if [[ "${1:-}" == "--drill" ]]; then
  : "${DRILL_ADMIN_URL:?Set DRILL_ADMIN_URL to a throwaway server's admin connection string}"
  psql "$DRILL_ADMIN_URL" -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS rkb_restore_drill' -c 'CREATE DATABASE rkb_restore_drill'
  RESTORE_URL="${DRILL_ADMIN_URL%/*}/rkb_restore_drill"
  pg_restore --no-owner --dbname="$RESTORE_URL" "$FILE"
  TABLES=(User Builder Project Plot Lead Subscription Invoice PaymentOrder Booking Review AuditLog)
  status=0
  for t in "${TABLES[@]}"; do
    a=$(psql "$DIRECT_URL" -tA -c "select count(*) from \"$t\"")
    b=$(psql "$RESTORE_URL" -tA -c "select count(*) from \"$t\"")
    if [[ "$a" == "$b" ]]; then echo "ok    $t: $a rows"; else echo "DIFF  $t: live $a, restored $b"; status=1; fi
  done
  psql "$DRILL_ADMIN_URL" -c 'DROP DATABASE rkb_restore_drill'
  exit $status
fi
