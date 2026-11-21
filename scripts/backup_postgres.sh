#!/usr/bin/env bash
# FIKRA AI — nightly PostgreSQL backup.
#
# Produces a compressed custom-format dump plus a SHA-256 checksum, then
# deletes backups older than RETENTION_DAYS. Safe to run while the app is up:
# pg_dump takes a consistent snapshot without blocking writers.
#
# Usage (on the production host):
#   DEPLOY_PATH=/opt/fikra scripts/backup_postgres.sh
#
# Environment overrides:
#   DEPLOY_PATH, COMPOSE_FILE, BACKUP_DIR, RETENTION_DAYS (default 14)

set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEPLOY_PATH/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_PATH/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# Read credentials from the running container rather than parsing .env, which
# may contain shell metacharacters in passwords.
DB_USER="$(compose exec -T postgres printenv POSTGRES_USER | tr -d '\r\n')"
DB_NAME="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r\n')"

if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "Could not read POSTGRES_USER/POSTGRES_DB from the postgres container." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="fikra-${timestamp}.dump.gz"
final="$BACKUP_DIR/$base"
tmp="$BACKUP_DIR/.${base}.partial"

log() { printf '[backup %s] %s\n' "$timestamp" "$*"; }

log "dumping database $DB_NAME as $DB_USER"
if ! compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc | gzip -9 > "$tmp"; then
  rm -f "$tmp"
  echo "pg_dump failed; no backup was published." >&2
  exit 1
fi

# A zero-byte or truncated gzip is worse than no backup — verify before publish.
gzip -t "$tmp"
test -s "$tmp"

sha256sum "$tmp" | awk '{print $1}' > "$tmp.sha256"
mv "$tmp" "$final"
mv "$tmp.sha256" "$final.sha256"
chmod 600 "$final" "$final.sha256"

log "wrote $final ($(du -h "$final" | cut -f1))"

# Retention is applied only after a successful backup, so a failed run never
# deletes the last known-good copy.
deleted=0
while IFS= read -r -d '' old; do
  rm -f "$old" "${old}.sha256"
  deleted=$((deleted + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'fikra-*.dump.gz' -mtime "+$RETENTION_DAYS" -print0)

log "removed $deleted backup(s) older than $RETENTION_DAYS days"
