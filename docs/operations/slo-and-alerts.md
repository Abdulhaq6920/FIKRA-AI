# FIKRA AI — SLOs, Alerts and Runbook

**Date:** 2026-11-21 · **Companion:** [Productionization Checklist](productionization-checklist.md),
[CD Pipeline](cd-pipeline.md), [Troubleshooting](troubleshooting.md)

This document defines what "healthy" means, lists every alert rule, and gives the first response
for each. An alert without a runbook is noise; keep this file updated when thresholds change.

---

## 1. Service level objectives

| SLO | Target | Measurement | Window |
|---|---|---|---|
| API availability | ≥ 99.5% successful requests | `http_requests_total` excluding expected 4xx | rolling 30d |
| End-to-end readiness | `/api/v1/health/ready` = 200 | `probe_success{probe="readiness"}` | continuous |
| Request latency | p95 ≤ 2 s, p99 ≤ 5 s | `http_request_duration_seconds` (health/metrics excluded) | rolling 30d |
| RAG latency | retrieval p95 ≤ 4 s; answer p95 ≤ 8 s | `rag_stage_duration_seconds{stage="retrieve"}`, HTTP chat route | rolling 30d |
| Answer quality | ≥ 70% of answers carry citations | `rag_requests_total{outcome="success"}` / all | rolling 30d |
| Ingestion success | ≥ 95% of jobs reach `ready` | `ingestion_jobs_total` | rolling 30d |
| DB pool headroom | in-use / pool ≤ 0.85 | `db_pool_in_use`, `db_pool_size` | continuous |
| LLM spend | < $10/hour estimated | `llm_cost_usd_total` | rolling 1h |

These are initial targets derived from the measured baseline in
[phase-gates.md](phase-gates.md) §G1.4. Revisit after the first month of production traffic; an SLO
that never fires is as unhelpful as one that fires constantly.

---

## 2. Deploying the stack

```bash
# On the production host, alongside the app stack:
cd /opt/fikra
# .env must contain ALERT_WEBHOOK_URL and GRAFANA_ADMIN_PASSWORD
docker compose -f docker-compose.monitoring.yml up -d
docker compose -f docker-compose.monitoring.yml ps
```

Validate config changes before reloading:

```bash
docker run --rm -v "$PWD/monitoring:/etc/prometheus/check:ro" \
  prom/prometheus:v2.54.1 \
  promtool check rules /etc/prometheus/check/prometheus/alerts.yml

curl -fsS -X POST http://127.0.0.1:9090/-/reload   # requires --web.enable-lifecycle
```

Grafana is provisioned automatically: the Prometheus datasource and the
**FIKRA AI — Production Overview** dashboard appear without manual import. UIs bind to
`127.0.0.1` only — put Grafana behind an authenticating reverse proxy before remote access.

### Alert routing

`monitoring/alertmanager/alertmanager.yml` sends everything to `${ALERT_WEBHOOK_URL}`. Critical and
warning alerts repeat hourly and go out within ~10 s; informational alerts wait 5 minutes and repeat
daily. A critical alert inhibits the warning variant of the same alert name. Set the webhook to a
Slack relay, PagerDuty, Opsgenie or any HTTP endpoint that accepts Alertmanager's JSON payload.

---

## 3. Alert inventory

| Alert | Severity | SLO |
|---|---|---|
| FikraBackendDown | critical | availability |
| FikraMetricsMissing | critical | availability |
| FikraReadinessFailing | critical | availability |
| FikraFrontendDown | critical | availability |
| FikraHighServerErrorRate | critical | availability |
| FikraElevatedServerErrorRate | warning | availability |
| FikraHighRequestLatencyP95 | warning | latency |
| FikraRagFailureRate | warning | quality |
| FikraRagNoCitations | warning | quality |
| FikraRagRetrievalSlow | warning | latency |
| FikraIngestionDeadJobs | warning | data |
| FikraIngestionQueueBacklog | warning | data |
| FikraWorkerQuiet | info | data |
| FikraDbPoolSaturation | warning | latency |
| FikraAuthFailureSpike | warning | security |
| FikraRateLimitSpike | info | security |
| FikraLlmCostSpike | warning | cost |
| FikraHostDiskFilling | warning | availability |

---

## 4. Runbook

Every entry starts with the same triage: check the **FIKRA AI — Production Overview** dashboard for
correlation, then grab a failing request ID from the structured logs (`request_id` field) before
changing anything. Roll back with `CD → Run workflow` and the last good SHA only when a deploy
correlates with the onset of the alert.

### FikraBackendDown

`/metrics` has been unreachable for 2 minutes. Check `docker compose -f docker-compose.prod.yml ps`
and `logs --tail=100 backend`. Common causes: container restart loop from a config validation
error, or the process still loading the ~130 MB embedding model (allow up to 90 s). If the container
is healthy but the port is dead, recreate it — do not rollback a migration for this alone.

### FikraMetricsMissing

The scrape target vanished rather than failing. Confirm `prometheus.yml` still has the
`fikra-backend` job and that the last config reload succeeded (`curl http://127.0.0.1:9090/-/status`).
A deleted or renamed compose service is the usual cause.

### FikraReadinessFailing

`/api/v1/health/ready` returned 503 for 5 minutes. Read the `checks` object in the response body to
identify the failing dependency:

- `database` → PostgreSQL down or pool exhausted; check `postgres` container and `db_pool_*`.
- `qdrant` → Qdrant URL/API key wrong or cluster unreachable; check `QDRANT_*` in host `.env`.
- `embedding_model` → model failed to load (offline cache missing or disk full).

Redis and Celery are reported but **not fatal** — the app degrades to inline ingestion. Do not page
for those labels.

### FikraFrontendDown

The blackbox probe did not get a 2xx from the Next.js root page. Check the `frontend` container logs.
A 500 at startup usually means the baked `BACKEND_URL` is unreachable; confirm the image was built
with the right build arg (see [cd-pipeline.md](cd-pipeline.md) §2).

### FikraHighServerErrorRate

More than 5% of requests are 5xx. Check the `route` label on `http_requests_total{status_class="5xx"}`
to find the affected endpoint, then inspect `rag_requests_total{outcome=~"error|app_error"}` and the
Groq provider logs. If the spike begins within 10 minutes of a deploy, roll back immediately.

### FikraElevatedServerErrorRate

Sustained 1–5% 5xx over 15 minutes. Investigate during business hours using the same steps as
above; this is an early warning, not a page.

### FikraHighRequestLatencyP95

p95 above 2 s for 10 minutes on non-health routes. Open the **RAG stage p95** panel: if `retrieve`
dominates, follow FikraRagRetrievalSlow; if `llm_generate` dominates, check Groq latency and model
load; if neither, look at `db_pool_saturation` and host CPU from node-exporter.

### FikraRagFailureRate

Over 5% of chat answers end in `error` or `app_error`. Check Groq API status, rate-limit responses
and `GROQ_API_KEY` validity. A sudden jump across all tenants usually means a provider outage or an
expired key, not a code defect.

### FikraRagNoCitations

Over 30% of answers have no citations. Confirm documents actually exist for the affected tenant, then
check `ingestion_jobs_total{status="dead"}` and `retrieval_candidates`. A common cause is a Qdrant
collection rebuilt without running `backend/scripts/backfill_qdrant.py`.

### FikraRagRetrievalSlow

Retrieval p95 above 4 s. Split the stage panel by `embed_query`, `vector_search`, `keyword_search`,
`fusion` and `rerank`. Slow `vector_search` points at Qdrant capacity; slow `keyword_search` points
at Postgres `pg_trgm` indexes; slow `rerank` points at CPU saturation on the API host.

### FikraIngestionDeadJobs

Jobs exhausted their retry budget. Read `ingestion_task_error` logs for the `error_type` and the
document ID. Malformed files are permanent failures; timeouts and connection errors indicate an
under-provisioned worker or an unavailable provider. Re-upload after fixing the cause.

### FikraIngestionQueueBacklog

More than 50 messages pending for 15 minutes. Check that the `worker` container is running and
consuming the `ingestion` queue (`docker compose logs worker`). If uploads are large, expect slower
drain; scale the worker only after confirming CPU/memory headroom.

### FikraWorkerQuiet

No ingestion job samples in 30 minutes. Usually harmless — no uploads means no jobs. If documents
are pending, verify the worker's Redis connection. This alert is informational; consider adding a
heartbeat metric if it proves too noisy.

### FikraDbPoolSaturation

Checked-out connections above 85% of the pool. Look for slow queries and long-running LLM calls
that hold sessions open. Raise the pool only if the database has headroom — a bigger pool on an
already saturated Postgres makes latency worse for everyone.

### FikraAuthFailureSpike

More than one authentication failure per second. Inspect the `reason` label. The per-IP login rate
limit should already be throttling the source; if failures are spread across many IPs, treat it as
credential stuffing and consider temporarily restricting public signup via `PUBLIC_SIGNUP_ORGS`.

### FikraRateLimitSpike

Sustained rejections above 5/s. Check the `scope` label to see which endpoint is hit and correlate
with `auth_failures_total`. A single misconfigured client retry loop is the most common cause.

### FikraLlmCostSpike

Estimated spend above $10/hour for 30 minutes. Compare `llm_tokens_total` by `model` and `direction`.
A model switch, a retry storm or an unbounded answer length are typical causes. Reduce
`GROQ_MAX_CONCURRENT_REQUESTS` if the provider is the bottleneck.

### FikraHostDiskFilling

Less than 15% free on a data filesystem. Check Postgres WAL growth, the uploads volume and rotated
logs. Run `scripts/backup_postgres.sh` before pruning anything, and review the backup retention
policy in [backup-and-restore.md](backup-and-restore.md).

---

## 5. Known gaps

- Synthetic login → ask → citation probe is not yet deployed; blackbox probes check availability,
  not RAG correctness. This is item 3.9 in the checklist.
- Alert delivery has not been rehearsed against a real webhook — fire a test alert after wiring
  `ALERT_WEBHOOK_URL`.
- No heartbeat metric exists for the Celery worker, so `FikraWorkerQuiet` infers silence from the
  absence of job samples.
