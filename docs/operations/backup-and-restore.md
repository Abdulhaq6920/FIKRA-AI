# FIKRA AI — Backup and Restore

**Date:** 2026-11-21 · **Companion:** [SLOs and Alerts](slo-and-alerts.md),
[CD Pipeline](cd-pipeline.md)

A nightly dump is only a backup if a restore has been rehearsed. These scripts use the running
Postgres container, so they work with the production compose stack without host-side `psql` tools.

---

## 1. What is backed up

| Data | Location | Covered by these scripts |
|---|---|---|
| Relational data (users, documents metadata, chats, analytics) | `postgres_data` volume | ✅ nightly `pg_dump` |
| Alembic schema version | relational data | ✅ included in dump |
| Vector embeddings | Qdrant (Cloud or `qdrant_data`) | ❌ see §4 |
| Uploaded files | `uploads_data` named volume | ❌ see §4 |
| Redis (broker/cache) | `redis_data` | ❌ disposable by design |

---

## 2. Nightly backup

On the production host:

```bash
# /etc/cron.d/fikra-backup — run at 02:15 UTC every day
15 2 * * * deploy DEPLOY_PATH=/opt/fikra /opt/fikra/scripts/backup_postgres.sh \
  >> /opt/fikra/backups/backup.log 2>&1
```

The script:

1. Reads `POSTGRES_USER` / `POSTGRES_DB` from the **running container**, not from `.env`.
2. Streams `pg_dump -Fc` through `gzip -9` into a temporary file.
3. Verifies the gzip stream and that the file is non-empty **before** publishing it.
4. Writes a `.sha256` sidecar and atomically renames both into place.
5. Deletes dumps older than `RETENTION_DAYS` (default 14) only after a successful run.

Override the defaults when needed:

```bash
DEPLOY_PATH=/opt/fikra BACKUP_DIR=/mnt/offsite/fikra RETENTION_DAYS=30 \
  /opt/fikra/scripts/backup_postgres.sh
```

### Offsite copy

A local nightly dump does not protect against host loss. Sync the compressed dumps and checksums to
object storage after the cron job:

```bash
# Example: rclone (configure separately, credentials outside the repo)
rclone copy /opt/fikra/backups remote:fikra-db-backups \
  --include '*.dump.gz' --include '*.sha256' --max-age 48h
```

Verify the remote copy is encrypted at rest and has an immutability/versioning policy, so a
compromised deploy key cannot delete the history.

---

## 3. Restore

**Destructive.** The script stops the API, worker and frontend, drops and recreates every table from
the dump, restarts the services and prints the restored `alembic_version`. It requires typing
`RESTORE` to confirm.

```bash
BACKUP_FILE=/opt/fikra/backups/fikra-20261121T020000Z.dump.gz \
  /opt/fikra/scripts/restore_postgres.sh
```

Before running in production:

1. Rehearse on staging with the same image/dump pair.
2. Verify the gzip and checksum (the script does this automatically, but do it explicitly once):
   ```bash
   gzip -t "$BACKUP_FILE"
   sha256sum -c <(printf '%s  %s\n' "$(cat "$BACKUP_FILE.sha256")" "$BACKUP_FILE")
   ```
3. Redeploy the code revision that produced the dump, or plan to run `alembic upgrade head` after the
   restore if the target code is newer. Restoring an old schema under new code will break the app.
4. Tell users the service will be briefly unavailable.

After the restore:

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health/ready
docker compose -f /opt/fikra/docker-compose.prod.yml logs --tail=100 backend
```

If `pg_restore` printed errors, the script exits non-zero even though services were restarted.
Treat the data as unverified until you have queried the affected tables.

### Restore drill

Run a restore drill at least quarterly: restore the latest dump into a throwaway database/container,
then assert row counts for `users`, `documents`, `chat_sessions` and `alembic_version`. Record the
date and result in [phase-gates.md](phase-gates.md).

---

## 4. Known gaps

- **Qdrant:** embeddings are not in the Postgres dump. Restoring Postgres alone will leave document
  metadata without vectors. Use `backend/scripts/backfill_qdrant.py` after a restore to rebuild the
  collection from stored text. If Qdrant Cloud is used, enable its own backups; for self-hosted
  Qdrant, snapshot the `qdrant_data` volume separately.
- **Uploads:** the `uploads_data` named volume is not backed up here. Before a single-host
  deployment goes live, add a volume snapshot (e.g. `restic` to object storage) or move uploads to
  object storage via the existing `storage/interface.py` abstraction.
- **PITR:** no WAL archiving is configured, so the recovery point is the last nightly dump (up to
  24 h of data loss). Managed Postgres with PITR is the recommended next step.
- **Never run `docker compose down -v`** on the production stack — it deletes these volumes.

---

## 5. Scheduler choice

`cron` is sufficient for a single host. If you prefer a container-native scheduler, add a one-shot
service to the monitoring compose file with an `entrypoint` calling `backup_postgres.sh` and a
host-level timer; do **not** run a second scheduler alongside cron, or dumps will collide.
