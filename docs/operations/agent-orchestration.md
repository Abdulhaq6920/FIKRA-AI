# FIKRA AI — Agent Orchestration Contract

**Date:** 2026-11-15
**Inputs:** [Audit Findings Register](audit-findings.md) · [Production Readiness Plan](production-readiness-plan.md)
**Reference model:** `3.docx` — AI-Native AppBuilder layering (Foundation → Data → Intelligence →
Experience & Prod), four cross-cutting concerns, phase activation order with confirmation gates.
Adapted **vendor-neutral**: no AWS service, credential or SDK is assumed anywhere below.

---

## 1. How this document is used

This is the operating contract for executing the readiness plan with agents.

* One **agent = one workstream**. An agent never edits a file it does not own (§5).
* The **orchestrator** (the main session) owns shared files, runs every gate, and is the only
  actor that declares a phase complete.
* A phase is complete only when its **gate** passes. A failed gate stops the line: fix, re-run,
  then continue. No phase is skipped, no gate is waived silently.
* Every agent returns a **report** in the fixed format of §6. A report without command output is
  not evidence and does not count as done.

---

## 2. Layer map (from the reference architecture to this repo)

| Layer (reference) | FIKRA implementation | Where |
|---|---|---|
| **Foundation** — infra, auth & identity, networking, multi-env | JWT + Argon2id, HttpOnly cookies, org membership, CORS, security headers, config validation, Docker Compose | `core/security.py`, `core/config.py`, `api/dependencies.py`, `core/middleware.py`, `docker-compose.yml` |
| **Data & Resources** — integrations, knowledge base, ontology, seed data | PostgreSQL 16 + pgvector, Alembic, uploads storage abstraction, Celery/Redis ingestion, seed script | `db/`, `alembic/`, `storage/`, `workers/`, `services/ingestion_service.py` |
| **Intelligence** — models, agents, orchestration, guardrails | Groq/Ollama clients, BGE embeddings, cross-encoder reranker, hybrid retrieval + RRF, RAG pipeline, prompt budget | `providers/`, `services/retrieval_service.py`, `services/rag_service.py` |
| **Experience & Prod** — UI, evaluation, observability, CI/CD, governance | Next.js app shell + feature modules, Playwright, metrics/traces/logs, CI pipeline, audit trail | `frontend/src/`, `core/metrics.py` (new), `core/telemetry.py` (new), `.github/workflows/` |

## 3. Cross-cutting concerns → concrete commitments

| Concern (reference) | FIKRA commitment | Verified by |
|---|---|---|
| **Governance & Security** — guardrails, PII, human-in-the-loop, access boundaries, audit trails | Explicit SQL predicates for every access boundary; role read from DB, not token; log redaction processor; `AuditLog` on every privilege change | G1.0 + G1.2 gate checks; `tests/tenant_isolation/` |
| **Observability** — tracing, cost tracking, drift detection, alerts | 16 metrics (§4.2 of the plan), per-stage RAG spans, one request ID across log/trace/response, LLM token + cost counters | `/metrics` scrape diff before/after a chat; trace for one `POST /chat/ask` |
| **Platform** — specs → requirements/design/tasks, hooks, CI/CD | This register + plan + orchestration doc are the spec; CI is the enforcement hook; every task in the plan has a `Done when` | G1.3 (CI) and G2.1 (CI blocking) |
| **Testing & Quality** — unit, integration, evaluation, chaos | Regression test per P0 before the fix; RAGAS-style offline eval set for answer quality; worker-kill and pool-exhaustion drills | G1.0 (`pytest`), G3.2 (chaos drills) |

---

## 4. Phase gates

Execution order is fixed. **Phase 0 is folded into Phase 1 as Stage 1.0** (decision recorded in
§7.1): its blockers are prerequisites for measuring anything, so they run first inside Phase 1.

| Gate | Name | Entry | Exit criteria (all must hold) |
|---|---|---|---|
| **G1.0** | Security floor | Phase 1 start | P0-1, P0-2, P0-3, P0-6, P0-7 closed; restricted-chunk regression test fails on pre-fix code and passes after; role demotion effective on the next request; `pytest tests/unit tests/tenant_isolation` green; live chat still answers with citations |
| **G1.1** | Schema integrity | after G1.0 | `alembic check` reports **no** drops/renames; `alembic upgrade head` on a fresh database matches the live schema (`pg_dump --schema-only` diff empty); `content_tsv` + GIN + vector index still present |
| **G1.2** | Observability | after G1.1 | `/metrics` returns all metric families; one chat request produces `rag_stage_duration_seconds` for every stage; response `X-Request-ID` == log `request_id` == span id; access log carries `user_id`/`org_id`; no secret in any log line |
| **G1.3** | API hardening | after G1.2 | 413 before routing on oversized upload; 422 (not 500) on bad path params; validation errors use the standard envelope without echoing input; CSRF origin check rejects a foreign `Origin`; rate limits cover the extended route list; production config rejects weak secrets/`DEBUG=true`/wildcard origins |
| **G1.4** | RAG latency | after G1.3 | Stage timings recorded before/after; p50 ≤ 4 s and p95 ≤ 8 s measured on the same machine; relevance gate applies in both retrieval branches; vector query is index-usable (`EXPLAIN` shows the index, not a seq scan + sort) |
| **G2.x** | CI + frontend | after G1.4 | CI blocking on lint/types/tests/`alembic check`/build/e2e; dead frontend module deleted; error/loading/not-found boundaries present; no swallowed mutation errors |
| **G3.x** | Deploy/data/scale | after G2.x | Production image builds and runs; migration job separate from app start; backup restore rehearsed; load test at 3× peak inside SLO |

**Gate protocol**

1. Orchestrator runs the gate commands (§8) from `backend/` or `frontend/` as noted.
2. Results are appended to `docs/operations/phase-gates.md` with date, commit-free working-tree
   state, command, and raw result.
3. Gate passes → next stage. Gate fails → the owning agent is re-tasked with the failure output;
   the gate is re-run; nothing else starts meanwhile.

---

## 5. Agent roster and file ownership

Concurrency rule: **two agents never hold the same file at the same time.** Files listed as
*shared* are edited only by the orchestrator, or only after the previous owner reports done.

| Agent | Workstream | Owns (write) | Reads | Blocking dependency |
|---|---|---|---|---|
| **A1** | WS-1 Authorization & tenancy | `services/retrieval_service.py` (authz predicates only), `api/dependencies.py`, `api/v1/auth.py`, `api/v1/admin_users.py`, `core/security.py`, `core/config.py` (validator), `tests/tenant_isolation/test_access_level.py` (new), `tests/unit/test_retrieval_access.py` (new) | models, schemas | none |
| **A2** | WS-2 Ingestion & jobs | `api/v1/documents.py`, `workers/document_tasks.py`, `workers/celery_app.py`, `services/ingestion_service.py`, `tests/unit/test_ingestion.py` | retrieval, models | none |
| **A3** | WS-3 Schema & migrations | `db/base.py`, `db/models/*.py`, `alembic/versions/*` (new revision only), `alembic/env.py` | services | none |
| **A4** | WS-4 Observability | `core/metrics.py` (new), `core/telemetry.py` (new), `core/middleware.py`, `core/logging.py`, `api/v1/health.py`, `services/rag_service.py`, `services/retrieval_service.py` (timings), `main.py` (instrumentation) | all | G1.0 + G1.1 |
| **A5** | WS-5 API hardening | `main.py` (rate limit/CSRF), `core/rate_limit.py`, `api/v1/admin.py`, `api/v1/notifications.py`, `schemas/*.py` | services | G1.2 |
| **A6** | WS-6 RAG latency | `services/retrieval_service.py`, `providers/reranker.py`, `providers/embeddings.py`, `core/redis.py` | metrics | G1.3 |
| **A7** | WS-7 CI | `.github/workflows/*` (new), `pyproject.toml` (tool config only) | all | G1.4 |
| **A8** | WS-8 Frontend | `frontend/src/**` | backend contracts | G1.4 |
| **A9** | WS-9 Deploy | `docker-compose*.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/next.config.mjs`, `scripts/` | all | G2.x |
| **A10** | WS-10 Capacity | docs only (`docs/operations/latency-ledger.md`) | metrics | G1.4 |

**Never touched by any agent:** `backend/.env`, any secret or credential file, `3.docx`
(contains third-party credentials — see §7.2), git history, remote configuration.

---

## 6. Agent report format (mandatory)

```
WORKSTREAM: WS-n <name>
STATUS: done | partial | blocked
CHANGED: <path> — <one line what and why>     (every file)
NOT CHANGED (deliberately): <path> — <reason>
VERIFIED:
  $ <exact command>
  <exact relevant output, trimmed to the lines that prove it>
REGRESSION RISK: <what could break, and how it was checked>
FOLLOW-UPS: <items discovered but out of scope, with file:line>
```

Rules for agents:

* Read the file before editing it; match surrounding style; `from __future__ import annotations`;
  line length 100; no mass reformatting; no new dependency unless the brief allows it.
* Every P0 fix ships with the test that would have caught it, and the test must be shown failing
  against the old behaviour (stash/comment the fix or reason from the assertion) and passing after.
* Run `ruff check` and `ruff format --check` **on touched files only**; mypy on touched modules
  when the module is already type-clean.
* Do not commit, do not push, do not run destructive git commands, do not edit `.env`.
* If a task turns out to need a schema change, **stop and report the DDL** instead of writing a
  second migration.

---

## 7. Decisions

### 7.1 Phase 0 is executed as Stage 1.0

The user directed execution to start at Phase 1. Phase 1's value depends on Phase 0's blockers:
you cannot measure "where did the 12 s go" on a path that leaks restricted content, and you cannot
harden an API whose authorization source of truth is a token claim. Therefore P0-1, P0-2, P0-3,
P0-6 and P0-7 run **first inside Phase 1** under gate **G1.0**, and the rest of Phase 0's tasks
(2.4 reconciler, 2.6 uniqueness, 2.8 decompression bounds, 3.3 composite indexes) are absorbed by
A2 and A3 rather than deferred.

### 7.2 Credentials in the workspace

`3.docx` contains live AWS access keys and a session token in plain text. It is untracked and is
now ignored by git. It is reference material only: no value from it is used, copied or logged.

### 7.3 No AWS coupling

The reference architecture's services (Bedrock, Textract, S3, Cognito, CloudWatch) are **not**
adopted. Each is satisfied by what the repo already runs:

| Reference service | FIKRA equivalent |
|---|---|
| Bedrock / AgentCore | Groq + local BGE embedder/reranker (`providers/`) |
| Textract | `services/ingestion_service.py` (PyMuPDF, RapidOCR, openpyxl, python-docx) |
| S3 | `storage/interface.py` local backend, S3-compatible backend as a Phase 3 option |
| Cognito | `core/security.py` + `services/auth_service.py` |
| CloudWatch / GenAI observability | Prometheus `/metrics` + OpenTelemetry + structlog JSON |

---

## 8. Gate command reference

Run from `backend/` unless stated otherwise.

```powershell
# G1.0 — security floor
..\.venv\Scripts\python.exe -m pytest tests/unit tests/tenant_isolation -q --override-ini=addopts=
..\.venv\Scripts\python.exe -m pytest tests/tenant_isolation -q --override-ini=addopts= -k access_level
..\.venv\Scripts\ruff.exe check app/services/retrieval_service.py app/api/dependencies.py app/api/v1/auth.py

# G1.1 — schema integrity
..\.venv\Scripts\python.exe -m alembic check
..\.venv\Scripts\python.exe -m alembic current

# G1.2 — observability
Invoke-WebRequest http://localhost:8000/metrics -UseBasicParsing | Select-Object -ExpandProperty Content
#   then: one POST /chat/ask, and assert the stage families moved

# G1.3 — API hardening
#   oversized upload -> 413; /admin/feedback/{not-a-uuid} -> 422; foreign Origin -> 403;
#   APP_ENV=production + weak JWT_SECRET_KEY -> boot fails

# G1.4 — RAG latency
#   two warm POST /chat/ask, read p50/p95 from http_request_duration_seconds and
#   rag_stage_duration_seconds; EXPLAIN the vector query

# Frontend (from frontend/)
npm.cmd run type-check
```

---

## 9. Progress ledger

| Gate | Status | Date | Evidence |
|---|---|---|---|
| G1.0 | pending | — | — |
| G1.1 | pending | — | — |
| G1.2 | pending | — | — |
| G1.3 | pending | — | — |
| G1.4 | pending | — | — |
| G2.1 | pending | — | — |
| G2.2 | pending | — | — |
| G3.1 | pending | — | — |
| G3.2 | pending | — | — |
