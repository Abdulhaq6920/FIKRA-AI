# FIKRA AI — Production Readiness Plan

**Date:** 2026-11-15
**Companion document:** [Audit Findings Register](audit-findings.md) (every defect, with file:line)
**Audience:** engineering, ops, and whoever signs the go-live.

---

## 1. Verdict and what "production ready" means here

The application **runs and works end to end**: login → documents → RAG answer with citations →
analytics → admin. The build is clean, the tests pass, and both services start without manual
intervention.

It is **not production ready**, for four reasons:

1. **Authorization has two holes** — restricted documents leak into chat retrieval (P0-1), and
   admin powers come from a JWT claim instead of the database (P0-2).
2. **Ingestion can take the API down** — extraction, chunking and embedding run on the event
   loop, and retry exhaustion never marks a document failed (P0-7).
3. **Nothing is observable** — a chat request takes 11.5 s while the LLM takes 981 ms, and no
   log, metric or trace tells you where the other 10.5 s go. You cannot operate what you cannot
   see.
4. **The schema no longer matches the migrations** — the next `--autogenerate` would drop the
   full-text column and the vector index (P0-4).

**Definition of done for this plan** (all must be true):

- [ ] Zero P0 findings open; every P1 closed or explicitly, in writing, accepted.
- [ ] Staging runs the **same** images, config and migration path as production.
- [ ] SLOs are defined, measured, alerting, and have a runbook entry each.
- [ ] A single chat request is traceable end to end in one page: stages, tokens, cost, error.
- [ ] A rollback (image + migration) has been rehearsed at least once.
- [ ] Load test at 3× projected peak passes with p95 inside SLO.
- [ ] Tenant-isolation and access-level tests exist and gate CI.

---

## 2. Workstreams at a glance

| # | Workstream | Why it blocks production | Phase |
|---|---|---|---|
| WS-1 | Authorization & tenancy correctness | Data leak across clearance levels; stale admin powers | Phase 0 |
| WS-2 | Ingestion & job robustness | API frozen by one upload; documents stuck forever | Phase 0 |
| WS-3 | Schema/migration integrity | Next autogenerate breaks search + vector index | Phase 0 |
| WS-4 | Runtime observability | Cannot diagnose or alert; 10 s of a 12 s request unexplained | Phase 1 |
| WS-5 | API surface hardening | CSRF, MIME, upload size, rate limit, config fail-fast | Phase 1 |
| WS-6 | RAG latency & retrieval quality | 11.5 s p50, disconnected relevance gate, unusable vector index | Phase 1 |
| WS-7 | Validation, CI, test depth | No CI at all; 0 tests on the two P0 bugs | Phase 2 |
| WS-8 | Frontend consolidation & UX states | Dead duplicate feature, lying empty states, no error boundary | Phase 2 |
| WS-9 | Deployment topology, backup/DR | Docker prod image broken; no backups, no migration job | Phase 3 |
| WS-10 | Capacity & cost model | Free-tier sizing cannot serve a 12 s CPU-bound pipeline | Phase 3 |

Sequencing matters: **WS-1/2/3 first** because they are data-integrity and security issues that
get harder to fix once real tenants exist. WS-4 before WS-6, because you cannot prove a latency
improvement without per-stage timings.

---

## 3. Phase 0 — Stop the bleeding (week 1)

Goal: nothing in this phase changes product behaviour except making it correct and safe.

### WS-1 · Authorization and tenancy

| Task | File | Done when |
|---|---|---|
| 1.1 Replace `access_condition or true()` with an explicit predicate list | `services/retrieval_service.py:161-167, 221-230` | `EXPLAIN` of the generated SQL contains `access_level = 'organization'` |
| 1.2 Add the regression test: restricted chunk invisible at `include_restricted=False` | `tests/tenant_isolation/` | Test fails on the old code, passes on the new |
| 1.3 Return `membership.role.value`, not the JWT claim | `api/dependencies.py:98, 121` | Demoting an admin takes effect on the next request |
| 1.4 Revoke refresh sessions on role change | `api/v1/admin_users.py:267-281` | Demoted user is logged out of refresh |
| 1.5 Add a Redis `jti` denylist checked in `_get_token_payload` | `core/security.py`, `api/dependencies.py:45-66` | Logout / role change / password reset invalidates the access token immediately |
| 1.6 Stop logging the password-reset token | `api/v1/auth.py:216-224` | `grep -r "dev_password_reset_token" app/` returns nothing |
| 1.7 Make production config fail fast | `core/config.py:277-290` | Boot with `APP_ENV=production` and a missing/random `JWT_SECRET_KEY`, `DEBUG=true`, or `ALLOWED_ORIGINS=*` **fails** |
| 1.8 Do not return the access token in the login/refresh JSON body | `api/v1/auth.py:129-133, 199-203`, `schemas/auth.py:32` | Cookies only; frontend only reads `user` |

**Estimates:** 1.1–1.2 (0.5 d), 1.3–1.5 (1.5 d), 1.6–1.8 (1 d).

### WS-2 · Ingestion and job robustness

| Task | File | Done when |
|---|---|---|
| 2.1 Offload extraction/chunking/embedding with `asyncio.to_thread` (bounded executor) | `api/v1/documents.py:473-589` | `/health/live` p99 < 50 ms during a 200-page upload |
| 2.2 Fix retry exhaustion → mark document + job `FAILED` with `error_type` | `workers/document_tasks.py:96-120` | Killing the worker mid-task leaves a terminal state, not `PROCESSING` forever |
| 2.3 Use a fresh loop per task (`asyncio.run`) and dispose the session in `finally` | `workers/document_tasks.py:46-55, 140` | No leaked asyncpg connections after 5 forced soft-timeouts (pool stays healthy) |
| 2.4 Add a reconciler: documents `PROCESSING` longer than N minutes → `FAILED` + notification | new `workers/maintenance_tasks.py` + Celery beat | Stuck documents self-heal within N minutes |
| 2.5 Narrow the Celery `try` so a post-publish DB failure never triggers inline processing | `api/v1/documents.py:207-232` | One upload ⇒ exactly one pipeline run |
| 2.6 `UNIQUE(document_id, chunk_index)` + idempotency guard | migration + `document_tasks.py` | Re-running ingestion twice leaves the chunk count unchanged |
| 2.7 Re-index: use `REINDEXING`, keep the doc retrievable, 409 on concurrent re-index | `api/v1/documents.py:357-392` | Document is answerable before, during and after a re-index |
| 2.8 Bound decompression: `Image.MAX_IMAGE_PIXELS`, `read_excel(nrows=)`, PDF page cap, zip entry caps, cached OCR engine | `services/ingestion_service.py:124, 190-229, 380` | A 50 MB zip bomb fails with a typed 4xx/`FAILED`, RSS stays flat |

**Estimates:** 2.1 (1 d), 2.2–2.4 (1.5 d), 2.5–2.7 (1 d), 2.8 (1 d).

### WS-3 · Schema and migration integrity

| Task | File | Done when |
|---|---|---|
| 3.1 Declare `content_tsv` (`Computed`) + GIN index + ivfflat index in the model | `db/models/document.py` | Autogenerate emits nothing for them |
| 3.2 Add `MetaData(naming_convention=…)` matching **existing** index names | `db/base.py` | `alembic check` reports no index renames |
| 3.3 Add the missing composite indexes and unique constraints | new migration | `alembic check` clean on a fresh DB built from migrations **and** on the live DB |
| 3.4 Make `embedding` `NOT NULL` after a backfill; add `WHERE embedding IS NOT NULL` | `retrieval_service.py:161`, model | A NULL embedding cannot 500 a tenant |
| 3.5 Verify a fresh install: `alembic upgrade head` into an empty DB, diff against prod schema (`pg_dump --schema-only`) | — | Diff is empty |

> **Sequencing trap:** do **not** run `alembic revision --autogenerate` before 3.1 and 3.2 are
> merged, or the generated migration will drop `content_tsv` and the vector index.

**Estimates:** 1.5 d.

**Phase 0 exit criteria:** P0-1…P0-8 closed; the two new P0 regression tests fail on the
pre-fix commit and pass after; a 200-page scanned PDF can be uploaded without any other endpoint
exceeding its latency SLO.

---

## 4. Phase 1 — Observability first, then performance (weeks 2–3)

### WS-4 · Runtime observability blueprint

This is the highest-leverage work in the whole plan. Build it before tuning anything.

#### 4.1 Three signals, one request ID

```
X-Request-ID  ──►  structlog contextvars ──►  every log line
                └─►  OpenTelemetry root span ──► every child span
                └─►  metric exemplar ──► Grafana/Tempo pivot
```

Fix the current ID bug first (`middleware.py:52` vs `:128`): generate the ID server-side, store it
on `request.state`, accept a client value only if it matches `^[A-Za-z0-9-]{8,64}$`, and read it
from state in the exception handler so response and logs always agree.

#### 4.2 Metrics to implement (Prometheus, `prometheus-client` is already a dependency)

| Metric | Type | Labels | Why |
|---|---|---|---|
| `http_requests_total` | counter | `method, route, status_class` | Traffic + error rate per route **template**, not raw path |
| `http_request_duration_seconds` | histogram | `method, route` | p50/p95/p99, the base of every SLO |
| `http_response_size_bytes` | histogram | `route` | Detect runaway payloads |
| `rag_stage_duration_seconds` | histogram | `stage` = `embed_query, vector_search, keyword_search, rerank, prompt_build, llm_generate, persist` | **The metric that explains the missing 10 s** |
| `rag_requests_total` | counter | `outcome` = `ok, no_context, provider_rate_limited, provider_error, cancelled` | Answer-quality and failure split |
| `retrieval_candidates` | histogram | `stage` = `vector, keyword, fused, reranked` | Recall collapse is silent otherwise |
| `retrieval_top_score` | histogram | — | Relevance distribution per tenant |
| `llm_tokens_total` | counter | `model, direction=input\|output` | Cost control and quota |
| `llm_cost_usd_total` | counter | `model` | Margin per tenant (labels: `organization`) |
| `llm_time_to_first_token_seconds` | histogram | `model` | The UX metric that actually matters for streaming |
| `ingestion_duration_seconds` | histogram | `extension, outcome` | Which file types are slow or failing |
| `ingestion_jobs_total` | counter | `status` | Queue health |
| `ingestion_queue_depth` | gauge | `queue` | Backpressure signal (Celery inspect or Redis `LLEN`) |
| `db_pool_in_use` / `db_pool_wait_seconds` | gauge/histogram | — | Pool exhaustion is the #1 silent outage cause here |
| `rate_limit_blocked_total` | counter | `scope` | Abuse vs. misconfiguration |
| `auth_failures_total` | counter | `reason` = `bad_password, inactive, no_membership, expired, invalid` | Credential-stuffing detection |

**Never** label by `organization_id` on high-cardinality request metrics (cardinality blow-up);
put org/user only on low-volume counters (`llm_cost_usd_total`) or in traces/logs.

#### 4.3 Tracing

Instrument with `opentelemetry-instrumentation-fastapi` + `-sqlalchemy` (both already in
`pyproject.toml`) and add **manual spans** for the pipeline:

```
POST /api/v1/chat/ask                     span, 12 200 ms
 ├─ auth.resolve                          4 ms
 ├─ retrieve                              10 100 ms      ← the answer
 │   ├─ embed_query                          780 ms
 │   ├─ vector_search                        90 ms
 │   ├─ keyword_search                       40 ms
 │   └─ rerank                             3 800 ms
 ├─ prompt.build                             60 ms
 ├─ llm.generate                           981 ms   (attrs: model, in/out tokens, ttft)
 └─ persist.messages                        30 ms
```

Span attributes to standardise: `organization.id`, `user.id`, `conversation.id`, `document.count`,
`llm.model`, `llm.tokens.input`, `llm.tokens.output`, `retrieval.top_score`, `answer.citations`.
Sample 100 % of errors and 10 % of successes (head-based) to keep cost sane.

#### 4.4 Logs

* Keep JSON (already good) but **add a redaction processor** for `password`, `token`,
  `authorization`, `cookie`, `groq_api_key`, `content` — deny-list + `[REDACTED]`.
* Add `user_id`, `org_id`, `route` to the access log (`middleware.py:80-88`); today it is
  method/path/status only.
* Add `duration_ms` thresholds: log at `WARNING` above `SLOW_REQUEST_MS` (default 5 000) so slow
  requests are greppable without a metrics stack.
* Make Celery emit the same JSON (`logging.py` bridges Celery but keeps the default format) and
  propagate the originating `request_id` through task headers so an upload can be followed into
  the worker.
* Turn off SQL echo outside local dev: `echo=settings.debug` at `db/session.py:45` should be
  `echo=settings.sql_echo` (new setting, default false).

#### 4.5 Error tracking and alerting

* Sentry (or equivalent) for backend + frontend, with `before_send` scrubbing and the same
  `request_id` as tags; release = git SHA.
* Prometheus + Grafana + Alertmanager (or Grafana Cloud / Better Stack if you want zero ops).
* Uptime/synthetic checks: external probe on `/api/v1/health/live` every 30 s and a **scripted
  login + ask** every 5 min from one region (the only check that proves RAG actually works).

#### 4.6 SLOs and alerts (start here, revisit after 2 weeks of data)

| SLO | Target | Alert |
|---|---|---|
| Availability (non-5xx on `/chat/ask`, `/documents`, `/auth/*`) | 99.5 % / 30 d | burn-rate 2 %/h fast burn, 5 %/6 h slow burn |
| Chat p95 latency (non-stream) | ≤ 8 s | p95 > 8 s for 10 min |
| Chat p95 latency (stream, time-to-first-token) | ≤ 2 s | p95 TTFT > 2 s for 10 min |
| Document ingestion p95 | ≤ 3 min for ≤ 20 MB | p95 > 5 min or queue depth > 50 for 10 min |
| Error budget on 5xx | ≤ 0.5 % | any 5xx rate > 1 % for 5 min |
| LLM provider error rate | ≤ 2 % | > 5 % for 5 min → failover/fallback page |
| DB pool saturation | < 80 % | > 80 % for 5 min |
| Readiness | 100 % of pods ready | any pod unready > 2 min |

**Runbook entries required for each alert** (symptom → check → mitigate → escalate). A pager
alert without a runbook link is a plan defect.

#### 4.7 Add the missing health signals

`GET /api/v1/health/ready` returns 503 for Redis even though the app degrades gracefully. Split:

| Endpoint | Contract |
|---|---|
| `/health/live` | process alive — no dependency checks, < 5 ms |
| `/health/ready` | DB reachable + embedding model loaded + **Celery worker heartbeat seen in last 60 s**; Redis is reported as `degraded` (200) unless the broker is mandatory |
| `/health/startup` | one-shot: migrations at head + embedding model warm |
| `/metrics` | Prometheus scrape (already in the logging skip-list) |

**Estimates:** 4.1–4.2 (2 d), 4.3 (2 d), 4.4 (1 d), 4.5 (1 d + infra), 4.6 (1 d), 4.7 (0.5 d).

### WS-5 · API surface hardening

| Task | Notes |
|---|---|
| CSRF: `Origin`/`Referer` allowlist middleware for unsafe methods + double-submit token for cookie auth; `__Host-` cookie prefixes; `Secure` always outside localhost | `SameSite=strict` alone is not a defence plan |
| Upload: `Content-Length` pre-check → **413** before routing; `FileTooLarge` → 413; MIME-vs-extension allowlist; serve downloads as `application/octet-stream` (except pdf/images) with `CSP: sandbox` | `documents.py:129-182, 437` |
| Rate limiting: move to Redis (sliding window), key by `user_id` when authenticated else trusted client IP (`X-Forwarded-For` only from an allowlisted proxy); extend policies to `/admin/*`, `/documents/*/reindex`, `/chat/feedback`, `/access-requests`, `/analytics/*` | `main.py:132-174`, `core/rate_limit.py` |
| Type every path/query param: `uuid.UUID`, `DocumentStatus`, enums → 422 not 500 | `admin.py:212, 285`, `documents.py:243` |
| Register a `RequestValidationError` handler that emits the standard envelope **without echoing input values** (login passwords currently echo) | `main.py:177` |
| Refresh sessions: store `organization_id`, rotate atomically (`UPDATE … WHERE is_revoked=false RETURNING`), detect reuse (revoke family), nightly cleanup of expired rows | `auth_service.py:219-258` |
| Audit every privilege change, feedback review and document deletion | `admin.py:283-330`, `documents.py:294` |
| Uniform 404 for "not in this tenant" (never 403 — it confirms existence) | `admin.py:224, 299`, `notifications.py:69` |
| Shared `PasswordStr` type across all four password schemas | `schemas/user_admin.py:38, 55` |
| Escape `%`/`_` in ILIKE search terms | `admin.py:141`, `insights_service.py:352` |

### WS-6 · RAG latency and retrieval quality (only after WS-4 is live)

Measured baseline: **p50 ≈ 11.5 s**, of which LLM ≈ 1 s. Targets: p50 ≤ 4 s, p95 ≤ 8 s.

| Task | Expected impact |
|---|---|
| Batch/parallelise: run vector + keyword search concurrently (`asyncio.gather`) | −40 ms |
| Serialize inference: dedicated `ThreadPoolExecutor(max_workers=1)`, `torch.set_num_threads(1)`, preload the reranker in `lifespan` (currently only the embedder is preloaded → first chat per worker stalls 2.2 s) | removes cold-start tail |
| Cache query embeddings (Redis, key = hash(query) + model version, TTL 1 h) | −0.8 s on repeats |
| Rerank fewer candidates (12 → 6) or replace `bge-reranker-base` with a smaller cross-encoder; make rerank depth configurable | −2 s to −3 s |
| Fix the vector query to be index-usable; switch ivfflat → HNSW, set `ef_search`, rebuild after load | removes seq-scan growth |
| Apply the relevance gate in **both** retrieval branches (reranker currently bypasses it) | quality + fewer wasted tokens |
| Replace `embed_query` on the request path with a warm, single-threaded encoder | −0.5 s |
| Stream by default in the UI (already supported server-side) and measure TTFT rather than total | perceived latency |

Re-measure with the WS-4 stage histograms after each change; keep a short "latency ledger" in
`docs/operations/` so regressions are visible.

### WS-7 · CI and test depth (start in Phase 1, complete in Phase 2)

There is **no CI** today. Minimum viable pipeline on every PR:

```
1. ruff check app/            (currently ~200 pre-existing violations → start with a changed-files ratchet)
2. mypy app/                  (strict; same ratchet)
3. pytest tests/unit tests/tenant_isolation
4. alembic check              (schema drift gate — would have caught P0-4)
5. pytest tests/integration   (PostgreSQL service container; the current SQLite default cannot
                               create UUID/JSONB/Vector columns — always set TEST_DATABASE_URL)
6. frontend: tsc --noEmit, next build, playwright smoke (login → ask → citation)
7. security: pip-audit + npm audit --production, secret scan (gitleaks), container scan (trivy)
```

Test-depth targets for GA:

| Area | Now | Target |
|---|---|---|
| Access-level / restricted retrieval | 0 | ≥ 6 (list, download, status, chat, analytics, admin) |
| Role change / revocation | 0 | ≥ 4 |
| Upload abuse (size, MIME, zip bomb) | 0 | ≥ 6 |
| Ingestion failure/retry/recovery | partial | ≥ 8 including worker-kill |
| Streaming cancel/disconnect persistence | 0 | ≥ 4 |
| Rate limiting | 0 | ≥ 4 (single + multi-replica) |
| Frontend E2E happy path | 1 | ≥ 6 (auth expiry, empty, error, 403) |

---

## 5. Phase 2 — Frontend consolidation and UX honesty (weeks 3–4)

The UI is visually consistent but structurally duplicated. The goal is **fewer implementations,
honest states, and no dead feature**.

### 5.1 Delete before you build

| Delete | Why |
|---|---|
| `features/admin/AnalyticsTab.tsx` (397 lines) | Never imported; stale copy of `OrganizationAnalytics.tsx` |
| Duplicated `Section`/`EmptyRow`/`Skeleton`/`Pagination` in `admin/page.tsx:940-987` | Already drifted from `InsightUi` |
| `AdminMember`/`getMembers`, `documentsApi.get/getStatus`, `chatApi.ask`, `chatSchema`, `TokenResponse` | Dead exports |
| Unused props `activeConversationId`, `onConversationSelect`, `onNewConversation`, `conversationRefreshTrigger` | Six dead branches in `AppShell` |
| Unused deps: `swr`, `js-cookie`, `class-variance-authority`, 9 Radix packages (or start using Toast/Dialog/Dropdown) | Bundle surface |
| `useHistoryNavigation` monkey-patch | Re-implements browser Back/Forward and fights Next |
| Non-functional social login buttons | Misleading |

### 5.2 One implementation per concept

| Concept | Today | Target |
|---|---|---|
| Pagination | 4 implementations, 3 label formats | `components/ui/Pagination` |
| Modal | 3 (one with Escape, two without) | `components/ui/Modal` with focus trap |
| Dropdown | 3 (only `ActionMenu` is accessible) | `ActionMenu` / Radix |
| Confirm | `window.confirm`, `window.prompt`, styled dialog | `ConfirmDialog` (typed name for delete) |
| Toast | 5 ad-hoc systems | one `ToastProvider` (Radix already installed) |
| Document table | `documents/page.tsx` + `DocumentsTab.tsx` | one `DocumentTable` with `variant` |
| Date/number/bytes formatting | 3 date philosophies | `lib/utils/format.ts` only, `toLocale*` banned by lint |
| Status colours | 3 maps | `lib/constants/STATUS_META` |
| Buttons | 5 primary styles | CVA variants `primary/secondary/ghost/danger` |
| "New chat" | 3 entry points with 2 behaviours | one command, create-on-first-message |

### 5.3 Honest states (the UX equivalent of observability)

* `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, per-route `loading.tsx`.
* Distinguish **empty** from **failed** everywhere (`chat` messages, `documents`, notifications,
  admin tabs). Today a 500 renders "No documents available yet."
* Never swallow a mutation error (`catch { /* ignore */ }` in the admin page and `AppShell`).
* Replace the hard-coded "System online" card with a real `/health/ready` probe.
* `<Suspense>` around every `useSearchParams()` consumer, or the build quietly degrades to CSR.
* Auth: distinguish 401 (session expired → notice on `/login`) from 403 (role → "you don't have
  permission"), and stop nulling the user on transient errors.
* Remove the 1500 ms login delay and the dead "Remember me" checkbox; add a real workspace
  picker for multi-org users.

### 5.4 Accessibility and interaction floor

Non-negotiable before GA: keyboard-reachable conversation list with rename/delete, focus trap +
Escape in every modal, `aria-current` on nav, visible focus rings, `prefers-reduced-motion`
respected by `AmbientMotion`, and no hover-only affordances.

### 5.5 Performance

| Change | Impact |
|---|---|
| Memoise `MarkdownContent`; batch SSE text at ~10 fps; skip syntax highlighting while streaming | Removes O(n²) re-parse per answer |
| `next/dynamic` the Prism bundle (light build + 5 languages) | `/chat` first load 418 kB → ~200 kB |
| `next/dynamic` the admin tabs | Opening Overview stops loading the document + question explorers |
| `api.get/post/patch/delete` accept `AbortSignal`; add request-id guards | Kills the stale-response races in 4 places |
| One visibility-aware `usePolling` hook | Replaces 4 unconditional pollers (10/15/5/1.5 s) |
| Drop or proxy the Google favicon fetch | Removes a third-party request per citation (and a document-domain leak) |
| One `AmbientMotion` instance at the shell, paused when hidden | Removes ~6 infinite animations per page |

### 5.6 Turn on server-side protection

All 13 routes currently build as `○ (Static)` client components, so a logged-out visitor receives
the `/chat` and `/admin` shell. Add `middleware.ts` that checks the refresh cookie and
redirects, and make page shells server components. This is **defence in depth, not authorization**
— the API stays the security boundary (and P0-2 is what makes that boundary truthful).

---

## 6. Phase 3 — Deploy, data, and scale (week 4+)

### 6.1 Environments

| Env | Purpose | Data | Notes |
|---|---|---|---|
| local | dev | seeded | `docker compose up postgres redis`, backend `--reload` |
| staging | pre-prod, 1 replica per service | anonymised subset | **Must** run the same image, the same env-var set, and the same migration job |
| production | live | real | ≥ 2 API replicas, ≥ 2 workers |

Config parity is enforced by generating one `.env.example` per environment from
`core/config.py` (a script that introspects the Pydantic model) and asserting in CI that they
match — the file is currently in sync, keep it that way mechanically.

### 6.2 Images and containers

| Task | Detail |
|---|---|
| Backend base image | Move `python:3.11-slim` → `3.12-slim` (matches the repo venv and `requires-python`); **install `.[dev]` only in the builder**, ship runtime deps only |
| Frontend build | Add `output: "standalone"` (the current prod stage cannot build — P0-5); pin `node:20-alpine`, run as non-root, `NEXT_TELEMETRY_DISABLED=1` |
| Process model | `gunicorn -k uvicorn.workers.UvicornWorker -w $WEB_CONCURRENCY --timeout 120 --graceful-timeout 30` with `--proxy-headers --forwarded-allow-ips`; be explicit that **each worker loads the embedder** |
| Healthchecks | `/health/live` for liveness, `/health/ready` for readiness, `start_period` ≥ 90 s (model warm-up) |
| Compose | Add a `docker-compose.prod.yml` without `--reload`, bind mounts or `./backend:/app`; the current file is development-only |
| Migrations | A **separate** one-shot job (`alembic upgrade head`) that runs before rollout, not inside app start; `alembic.ini` requires `DATABASE_URL` in the environment |
| Secrets | Injected at runtime (Render/SSM/Vault), never in the image or repo; rotate `JWT_SECRET_KEY` with a dual-key verification window |

### 6.3 Boot order and rollback

```
migrate (job)  →  workers  →  API replicas one-by-one (readiness gated)  →  frontend
```

Rollback must be rehearsed: keep the previous image tag deployed-ready, and make every migration
**backwards compatible for one release** (add column → deploy → backfill → drop in the next
release). No destructive migration in the same release as the code that stops using the column.

### 6.4 Data protection

| Item | Requirement |
|---|---|
| Backups | Automated nightly `pg_dump` + PITR (WAL) with **restore drill quarterly**; retention 30 d |
| Uploads | Move from local disk to S3-compatible object storage before scaling past one node (`storage/interface.py` already abstracts this — implement `S3StorageBackend`) |
| Retention | Soft-deleted conversations are still fully readable in analytics (P1-L11) — decide the policy, implement it, and document it; add a purge job for expired `refresh_sessions` and `usage_records` |
| Deletion | Document delete must remove DB row + file + citations consistently (P1-L10); today a failed commit orphans a file or leaves an un-downloadable row |
| PII | Redaction processor in logging; no document content in logs; encryption at rest on the DB volume |

### 6.5 Capacity and cost model

Measured on the audit machine (CPU inference): `embed_query` 0.77 s, `rerank(12)` 3.8 s, LLM 1 s,
total ≈ 12 s per chat. That is **CPU-bound**, single-process, and not parallel-friendly.

| Decision | Recommendation |
|---|---|
| CPU | ≥ 2 vCPU per API replica; the free/0.1-CPU plans cannot serve this pipeline |
| Memory | Embedder ≈ 400–600 MB RSS per worker; reranker ≈ 1.1 GB fp32. **Do not** run 4 uvicorn workers on a 1 GB instance |
| Worker count | Start with 2 API workers × 2 replicas; each loads both models → budget ~3 GB |
| Celery | `--concurrency=1` for the `ingestion` queue (torch already saturates cores), `worker_max_tasks_per_child=50`, real dead-letter queue (`celery_app.py:45` mentions one that does not exist) |
| DB connections | `pool_size` × (API workers + worker children). With 2×2 + 2 = 6 processes at `pool_size=5` you need 30 connections — verify against the plan's limit (Neon free = 10) |
| Models | If p95 must be < 4 s, move embeddings+rerank to a dedicated inference service (ONNX int8 or a GPU box) or to a hosted embedding API; then the API scales horizontally for free |
| Cost | Track `llm_cost_usd_total` per organisation from day one; cost per answer is currently unattributed because streaming records the **primary** model even when the fallback answered (`rag_service.py:264`) |

Target after WS-6: **p50 ≤ 4 s, p95 ≤ 8 s, 20 concurrent chats per replica** without errors.
Load test with k6/Locust at 1×, 2×, 3× projected peak; record the knee.

### 6.6 Reliability patterns to add

* **Timeouts everywhere:** provider calls, DB statements (`SET LOCAL statement_timeout`), storage
  I/O. A hung dependency must fail fast, never pin a worker.
* **Circuit breaker** around Groq/Ollama with fallback model + `Retry-After` surfaced to the UI.
* **Idempotency key** on `POST /chat/ask` (a double-click currently creates two messages and
  double-bills) and on upload.
* **Graceful shutdown:** stop accepting, drain in-flight streams, dispose the pool, flush metrics.
* **Backpressure:** bound the ingestion queue and reject uploads with 429 when depth > N rather
  than accepting work you cannot do.

---

## 7. Go-live checklist

**Security**
- [ ] P0-1, P0-2 fixed with regression tests; restricted-doc leak reproducible on `main` before, not after
- [ ] Role demotion effective immediately; access-token denylist tested
- [ ] Production config validator rejects weak/missing secrets, `DEBUG=true`, wildcard origins
- [ ] CSRF protection in place for cookie-authenticated mutations
- [ ] Upload: size, MIME, decompression limits enforced; downloads served as octet-stream
- [ ] Rate limits on every abuse-prone route, Redis-backed, keyed by user when authenticated
- [ ] Dependency and container scans clean; no secrets in the repo or image layers

**Observability**
- [ ] `/metrics` scraped; the 16 metrics in §4.2 live with the documented labels
- [ ] Every chat request traceable end to end with per-stage spans
- [ ] SLOs recorded, alerts firing into a real channel, each with a runbook link
- [ ] Error tracking with release + request-id correlation, frontend included
- [ ] Synthetic login+ask probe running every 5 min

**Operations**
- [ ] `alembic check` clean; migrations applied by a job, not by app start
- [ ] Backups automated; **restore rehearsed**; documented RPO/RTO
- [ ] Rollback rehearsed (image + migration)
- [ ] Runbooks: DB pool exhaustion, provider 429/outage, Redis down, ingestion backlog, disk full
- [ ] Dashboards: golden signals, RAG pipeline, ingestion, LLM cost

**Quality**
- [ ] CI green and blocking (lint, types, tests, `alembic check`, build, e2e)
- [ ] Tenant-isolation + access-level suites green
- [ ] Load test at 3× peak inside SLO
- [ ] Frontend: error/loading/not-found boundaries in place; no swallowed errors; keyboard paths verified

**UAT**
- [ ] Login (incl. session expiry), document upload → ready → cited answer, feedback, admin
      review, analytics, role change — executed on staging by someone who is not the author.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Next `--autogenerate` drops `content_tsv`/vector index | High if anyone runs it before WS-3 | Keyword search + vector perf break in one deploy | Freeze autogenerate until 3.1/3.2 land; add `alembic check` to CI |
| CPU-bound RAG cannot hold p95 < 8 s under load | High | Product unusable at modest concurrency | WS-6 + move inference to a dedicated service; load-test early |
| Per-worker model memory OOMs a small instance | Medium | Crash loop | Worker count × RSS budget documented and enforced; readiness `start_period` |
| In-memory rate limiting + per-process cancel registry break on multi-replica | High once scaled | Ineffective limits, cancellation only works on one pod | Redis-backed limiter and cancel flag (WS-5) |
| Local-disk uploads with > 1 replica | High once scaled | 404 downloads, failed ingestion on the "other" node | Object storage before scaling out |
| Migration during rollout breaks the previous version | Medium | Failed deploy, no rollback | Expand/contract migrations, one release of compatibility |
| Tests pass but the two P0 bugs remain | Certain today | False confidence | Regression tests first, then CI gate |

---

## 9. Summary timeline

| Week | Focus | Exit |
|---|---|---|
| 1 | Phase 0: WS-1, WS-2, WS-3 | No known data leak, no stuck documents, schema matches migrations, P0 tests in CI |
| 2 | WS-4 observability | One page answers "where did the 12 s go?"; SLOs alerting |
| 3 | WS-5 + WS-6 | Security checklist green; p50 ≤ 4 s measured with stage timings |
| 4 | WS-7 + WS-8 + WS-9 | CI blocking, frontend consolidated, staging = production parity, backups restored once |
| 5 | WS-10, load test, UAT, rehearsal | Go-live checklist fully checked → launch |

Total: **~5 engineering-weeks** for one experienced full-stack developer, or **~2.5 calendar
weeks** with two (backend + frontend) working in parallel after Phase 0.
