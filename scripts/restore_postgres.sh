#!/usr/bin/env bash
# FIKRA AI — restore a PostgreSQL backup.
#
# DESTRUCTIVE: replaces every table in the target database. Requires an
# explicit confirmation and stops the API/worker first so no writes race the
# restore. Always rehearse on staging before using this in production.
#
# Usage:
#   BACKUP_FILE=/opt/fikra/backups/fikra-20261121T020000Z.dump.gz \
#     scripts/restore_postgres.sh
#
# After a restore, redeploy the code revision that produced the dump or run
# `docker compose -f docker-compose.prod.yml run --rm migrate alembic upgrade head`
# if the target is a newer schema. See docs/operations/backup-and-restore.md.

set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEPLOY_PATH/docker-compose.prod.yml}"
BACKUP_FILE="${BACKUP_FILE:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "BACKUP_FILE is required (path to a fikra-*.dump.gz)." >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup not found: $BACKUP_FILE" >&2
  exit 1
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

# Verify integrity before touching the running system.
gzip -t "$BACKUP_FILE"
if [[ -f "$BACKUP_FILE.sha256" ]]; then
  expected="$(tr -d '\r\n ' < "$BACKUP_FILE.sha256")"
  actual="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
  if [[ "$expected" != "$actual" ]]; then
    echo "Checksum mismatch — refusing to restore." >&2
    exit 1
  fi
  echo "Checksum verified: $actual"
fi

echo "WARNING: this will drop and recreate all tables in the production database."
echo "Backup: $BACKUP_FILE"
printf 'Type RESTORE to continue: '
read -r confirmation
if [[ "$confirmation" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

DB_USER="$(compose exec -T postgres printenv POSTGRES_USER | tr -d '\r\n')"
DB_NAME="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r\n')"

echo "Stopping API, worker and frontend to prevent writes during restore..."
compose stop backend worker frontend

restore_ok=0
if gzip -cd "$BACKUP_FILE" \
  | compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" \
      --clean --if-exists --no-owner --no-privileges; then
  restore_ok=1
else
  echo "pg_restore reported errors — check the output above carefully." >&2
fi

echo "Restarting application services..."
compose start backend worker frontend

if [[ "$restore_ok" -ne 1 ]]; then
  echo "Restore may be incomplete. Verify with psql before trusting the data." >&2
  exit 1
fi

echo "Verifying alembic_version..."
compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" \
  -c 'SELECT version_num FROM alembic_version;'

echo "Restore complete. Confirm health: curl -fsS http://127.0.0.1:8000/api/v1/health/ready"
