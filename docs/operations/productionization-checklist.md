# FIKRA AI — Productionization Checklist

**Date:** 2026-11-21 · **Scope:** everything required to operate this service safely with real
tenants. This is the working backlog for the hardening effort; statuses are deliberately conservative
— "config provided" is **not** "running in production".

Legend:

| Mark | Meaning |
|---|---|
| ✅ | Present in the repo today |
| 🔧 | Implemented in the 2026-11-21 hardening pass |
| 📋 | Config/script/checklist delivered; an operator must wire up external infra |
| ⬜ | Still open — needs code, an external service, or a rehearsal |

---

## 1. Build and delivery

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 1.1 | CI gates lint, types, migrations, tests, builds, E2E | ✅ | `.github/workflows/ci.yml` (4 jobs) |
| 1.2 | CD pushes immutable SHA-tagged images and rolls out with rollback | ✅ | `.github/workflows/cd.yml`, `deploy/deploy.sh` |
| 1.3 | Production-only compose (no bind mounts / `--reload` / exposed DB) | ✅ | `docker-compose.prod.yml` |
| 1.4 | Build contexts exclude secrets and local artifacts | 🔧 | `backend/.dockerignore`, `frontend/.dockerignore` |
| 1.5 | Production image ships runtime dependencies only | 🔧 | `backend/Dockerfile` multi-stage install |
| 1.6 | Frontend image runs as non-root | ✅ | `frontend/Dockerfile` `USER node` |
| 1.7 | Dependency / container / secret scanning in CI | ⬜ | Add `pip-audit`, `npm audit --omit=dev`, Trivy, gitleaks once the current advisories are triaged (npm currently reports 15) |
| 1.8 | Pin third-party Actions to commit SHAs | ⬜ | Supply-chain hardening; requires a Dependabot-style update flow |

## 2. Security

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 2.1 | Production config fails fast on weak secrets / wildcard CORS | ✅ | `Settings.validate_production_secrets` |
| 2.2 | CSRF origin checks, body-size cap, security headers | ✅ | `core/hardening.py`, `core/middleware.py` |
| 2.3 | Tenant isolation regression tests | ✅ | `tests/tenant_isolation/` |
| 2.4 | Secrets never baked into images | 🔧 | `.dockerignore` excludes `.env*`; compose injects at runtime |
| 2.5 | Rate limits hold across replicas/workers and key by identity | 🔧 / ⬜ | Redis sliding window added; user-keyed limits and trusted-proxy IP handling still open |
| 2.6 | Secret rotation runbook (JWT/DB/provider keys) | ⬜ | Document dual-key verification window before first rotation |
| 2.7 | Error tracking with request-ID correlation | ⬜ | Sentry (or equivalent) for API + frontend, release = git SHA |

## 3. Observability and alerting

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 3.1 | Structured JSON logs with request IDs and redaction | ✅ | `core/logging.py` |
| 3.2 | Prometheus metrics (HTTP, RAG stages, LLM, ingestion, pool) | ✅ | `core/metrics.py` (17 families), `/metrics` |
| 3.3 | Liveness / readiness / startup probes | ✅ | `api/v1/health.py`, wired in `docker-compose.prod.yml` |
| 3.4 | Alert rules for the documented SLOs | 📋 | `monitoring/prometheus/alerts.yml` |
| 3.5 | Grafana dashboard (golden signals, RAG, ingestion, cost) | 📋 | `monitoring/grafana/dashboard.json` |
| 3.6 | Prometheus + Grafana stack definition | 📋 | `docker-compose.monitoring.yml` |
| 3.7 | SLO targets and a runbook per alert | 📋 | `docs/operations/slo-and-alerts.md` |
| 3.8 | Scraper, Alertmanager and dashboards actually deployed | ⬜ | Requires a host with capacity and notification channel |
| 3.9 | Synthetic login → ask → citation probe every 5 min | ⬜ | Script + scheduler; the only check that proves RAG works end to end |

## 4. Data protection and durability

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 4.1 | Migrations applied by a one-shot job before rollout | ✅ | `cd.yml` / `deploy.sh` `migrate` service |
| 4.2 | Backup/restore rehearsed once | ✅ | `phase-gates.md` §G3.x (historical baseline) |
| 4.3 | Automated nightly backups with retention + restore drill | 📋 | `scripts/backup_postgres.sh`, `scripts/restore_postgres.sh`, schedule on host |
| 4.4 | PITR / WAL archiving | ⬜ | Requires managed Postgres or `archive_command` + object storage |
| 4.5 | Retention purge for expired sessions / usage records | ⬜ | Celery beat task, not yet implemented |
| 4.6 | Uploads on shared object storage before scaling past one node | ⬜ | `storage/interface.py` abstraction exists; S3 backend not implemented |
| 4.7 | Encryption at rest on DB volume | ⬜ | Host / managed-service responsibility |

## 5. Reliability and performance

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 5.1 | Retrieval p50 ≤ 4 s / p95 ≤ 8 s at the measured corpus | ✅ | `phase-gates.md` §G1.4 |
| 5.2 | Load test at 3× peak | ⬜ | Needs k6/Locust and a staging host (O-4) |
| 5.3 | Redis-backed rate limiter (multi-replica) | 🔧 | `core/rate_limit.py` with in-memory fallback |
| 5.4 | Graceful shutdown / drain in-flight streams | ⬜ | Uvicorn graceful timeout + cancellation registry follow-up |
| 5.5 | Timeouts and circuit breaker around the LLM provider | ⬜ | Provider calls have timeouts; no breaker yet |
| 5.6 | Idempotency keys on chat/ask and upload | ⬜ | Double-click currently creates two messages |
| 5.7 | Backpressure when the ingestion queue is full | ⬜ | Queue depth is measured; uploads are not rejected yet |
| 5.8 | Expand/contract rule for destructive migrations | ✅ / ⬜ | Documented in CD guide; 0005 is a one-off exception needing a reindex runbook |

## 6. Frontend quality

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 6.1 | Type-check and production build pass | ✅ | CI `frontend` job |
| 6.2 | Error / loading / not-found boundaries | ✅ | `app/error.tsx` et al. |
| 6.3 | ESLint config committed and runnable | 🔧 | `frontend/.eslintrc.json` |
| 6.4 | `/chat` first load reduced from 419 kB | ⬜ | Split markdown/theme chunks with `next/dynamic` (O-9) |
| 6.5 | Dead dependencies removed | ⬜ | `swr`, `js-cookie`, CVA and unused Radix packages (plan §5.1) |

## 7. Testing and gates

| # | Requirement | Status | Evidence / next action |
|---|---|---|---|
| 7.1 | Unit + tenant-isolation + integration + E2E suites | ✅ | CI jobs |
| 7.2 | Regression tests for the new distributed limiter | 🔧 | `tests/unit/test_rate_limit.py` |
| 7.3 | Ruff findings in `tests/` cleaned up | ⬜ | O-11 (124 pre-existing findings) |
| 7.4 | Remote CI green + branch protection enforced | ⬜ | O-1 — requires a push and repo admin action |
| 7.5 | Staging = production config parity check | ⬜ | Generate `.env.example` per env from `Settings` and assert in CI |

---

## Execution order

1. **Do now (in repo, no external dependency):** items 1.4, 1.5, 2.4, 2.5, 3.4–3.7, 4.3, 6.3, 7.2.
2. **Next (needs a host / credentials):** 3.8, 3.9, 1.7, 7.4, 4.4.
3. **Then (behavioural changes, each with tests):** 5.4–5.7, 6.4, 6.5, 4.5, 2.6.
4. **Last (capacity and DR):** 5.2, 4.6, 4.7, 7.5.

Nothing in the "Do now" group changes application behaviour except the rate limiter, which keeps a
local fallback and is therefore safe to roll out with Redis unavailable.
