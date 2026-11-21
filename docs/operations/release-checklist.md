# FIKRA AI — Production Readiness Checklist

**Release under test:** royal-glass chat redesign, per-user favourite questions, performance work,
consolidated UI/error surfaces, CI + observability hardening, Qdrant vector-store cutover
**Original assessment:** 2026-11-18 · **Statuses re-verified:** 2026-11-21
**Companion documents:** [Production Readiness Plan](production-readiness-plan.md) (why each gate exists),
[Phase Gate Evidence Log](phase-gates.md) (append-only record of the security, schema, observability
and hardening gates), [Audit Findings Register](audit-findings.md) (defects with file:line),
[Security Checklist](security-checklist.md)

> This revision closes every item that can be closed from this host. Items that need a Docker-capable
> host, a load generator, a remote CI run, or a live Qdrant service are recorded as **blocked**, not
> as passes. No secret, credential, `.env` file, commit or push was made as part of this review.

---

## 1. Verdict

| Audience | Verdict |
|---|---|
| **Staging — currently running baseline (0004 / pgvector)** | ✅ **Ready.** All code, schema, test and configuration gates below pass locally on the running baseline. |
| **Staging — Qdrant head (0005, uncommitted working tree)** | ⚠️ **Blocked.** The migration drops `document_chunks.embedding` and the ivfflat index, but no Qdrant service is running here, no Qdrant service is defined in `docker-compose.yml`, and the live DB is still at `0004` (`alembic check` → `Target database is not up to date`). See **O-13**. |
| **Production sign-off** | ⚠️ **Conditional.** All *application* gates pass. Remaining: first remote CI green run + branch protection (O-1), alerting/SLOs (O-2), production image build/rollback on a Docker host (O-3), 3× load test (O-4), and the Qdrant cutover verification (O-13). Backup/restore rehearsal, mypy, error boundaries, performance evidence and the three UI findings are now **closed**. |

Nothing in section 2 is a failing code defect on the running baseline. The open items in **§4** are
operational or in-flight work; they must close, or be accepted in writing, before go-live.

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Verified in this release, with the command and result recorded below |
| ⚠️ | Open — needs an owner outside this repository, external tooling, or the Qdrant cutover |
| ⛔ | Blocking defect. **None on the running baseline.** |

### Verification run — 2026-11-21 (this host)

```
backend$  python -c "import app.main"                       import ok
backend$  ruff check app/ && ruff format --check app/       All checks passed / 64 files formatted
backend$  mypy app/                                         Success: no issues found in 64 source files
backend$  pytest tests/unit tests/tenant_isolation -q       105 passed (incl. 3 logging tests)
backend$  TEST_DATABASE_URL=<scratch PostgreSQL> pytest tests/integration -q
                                                           55 passed (4 warnings)
backend$  alembic heads / current                           0005 (head) / 0004  ← see O-13
frontend$ npm.cmd run type-check                            clean (tsc --noEmit)
live      GET /health/live 200 · /health/ready 200 (database, embedding_model, redis, celery = ok)
          GET /health/startup 200 (migrations: at_head:0004) · GET /login 200
```

---

## 2. Gate checklist

### A · Build and types

| # | Gate | Status | Evidence |
|---|---|---|---|
| A-1 | Backend imports cleanly | ✅ | `python -c "import app.main"` → `import ok` (re-verified 2026-11-21) |
| A-2 | Frontend type-check passes | ✅ | `npm.cmd run type-check` → no output, exit 0 (re-verified 2026-11-21) |
| A-3 | Frontend production build passes | ✅ | `npm.cmd run build` → compiled successfully, 13 routes (G2.2 final rerun, 2026-11-19) |
| A-4 | Production bundle actually serves | ✅ | `next start` on `127.0.0.1:3000`; `/login`, `/chat`, `/documents`, `/settings`, `/analytics`, `/admin` all 200, no page errors (G2.2). Dev server `/login` → 200 today. |
| A-5 | Lint/format clean on backend app code | ✅ | `ruff check app/` → all checks passed; `ruff format --check app/` → 64 files already formatted. `ruff check tests/` still reports 124 pre-existing findings (O-11). |
| A-6 | Lint/format clean on frontend files | ✅ | Build's lint stage passed; no ESLint config is committed (O-7) |
| A-7 | Static typing across backend | ✅ | `mypy app/` → **no issues in 64 source files**; the 61 pre-existing strict errors were fixed, not baselined (O-6 closed). Wired into CI. |
| A-8 | Bundle sizes inspected | ✅ | `/chat` 288 kB route / 419 kB first load; shared JS 87.3 kB. Tracked as O-9. |

### B · Tests

| # | Gate | Status | Evidence |
|---|---|---|---|
| B-1 | Unit + tenant-isolation suites | ✅ | `pytest tests/unit tests/tenant_isolation -q` → **105 passed**, including 3 logging/rotation tests (re-verified 2026-11-21) |
| B-2 | Integration suite on real PostgreSQL | ✅ | Fresh scratch DB → **55 passed** (re-verified 2026-11-21; second full run after the logging change also 55 passed). Warnings are benign (pydantic namespace, pytest config, passlib). |
| B-3 | Tenant-isolation tests gate the two historical fail-opens | ✅ | `test_retrieval_access.py` proves the JWT `role` claim is never returned and a demoted admin is refused on the next request |
| B-4 | Favourite questions are isolated per user **and** per tenant | ✅ | `tests/integration/test_favorite_questions_isolation.py`: same-org colleague sees `[]`, cross-tenant delete → 404, save is idempotent + whitespace-normalised |
| B-5 | Groq is mocked in unit tests (no live calls) | ✅ | Suite runs offline in ~7 s |
| B-6 | Chat stream persists citations + usage | ✅ | `test_chat_stream_analytics.py` (fake `RAGService`, real DB) passes |
| B-7 | Tests fail loudly, not silently, on schema drift | ✅ | Fixtures inserting `embedding = NULL` after `NOT NULL` and a stale `RAGService` test double were both fixed (the Qdrant cutover removes that column entirely — O-13). |
| B-8 | CI runs the suites on every push | ⚠️ | `.github/workflows/ci.yml` exists with 4 jobs (backend, frontend, docker, frontend-e2e) and parses locally; first remote Actions run and branch protection are not verifiable without a push (O-1). |

### C · Database and migrations

| # | Gate | Status | Evidence |
|---|---|---|---|
| C-1 | Live DB at migration head | ⚠️ | Live `/health/startup` → `at_head:0004`; `alembic heads` → `0005 (head)` in the working tree. The Qdrant revision is uncommitted and unapplied — see O-13. |
| C-2 | Models and DB agree (no autogenerate drift) | ⚠️ | On a fresh DB at 0004: `alembic check` → `No new upgrade operations detected` (G3.x). Against the live DB today: `FAILED: Target database is not up to date` because 0005 is not applied. See O-13. |
| C-3 | Fresh install from migrations alone | ⚠️ | 0001→0004 rehearsed clean on a fresh DB (G3.x, `alembic check` clean). 0005-on-fresh-DB has **not** been rehearsed against a live Qdrant service — see O-13. |
| C-4 | Drift-sensitive objects survive a fresh install | ✅ | Verified at 0004: `content_tsv` `is_generated=ALWAYS`, GIN index 1, ivfflat index 1, `embedding` `is_nullable=NO`. 0005 intentionally drops the last two when Qdrant takes over. |
| C-5 | Hot-path indexes exist in a fresh install | ✅ | `ix_conversations_owner_active_updated`, `ix_messages_conversation_created`, `ix_notifications_recipient_read_created`, `ix_feedback_org_status_created`, `favorite_questions` — all present at 0004. |
| C-6 | Every migration is reversible | ⚠️ | 0001→0004 `upgrade → downgrade → upgrade` exit 0, 17 tables restored (G3.x). 0005's downgrade recreates the column/index but **cannot restore vectors** — documents must be reindexed; documented in the revision (O-13). |
| C-7 | Migrations run before the app serves traffic | ✅ | `/api/v1/health/startup` → 200, `migrations: at_head:0004` (503 until then). The probe mechanism is correct; it will report 0005 once applied. |
| C-8 | One favourite per question per user, enforced by the DB | ✅ | 0003 unique index on `(organization_id, user_id, question)`; concurrent duplicate handled by `IntegrityError` fallback |

### D · Auth, sessions and tenancy

| # | Gate | Status | Evidence |
|---|---|---|---|
| D-1 | Cookies are `HttpOnly`, `SameSite=strict`, `Secure` in production | ✅ | `auth.py` `set_cookie(... samesite="strict", secure=settings.is_production)` |
| D-2 | Access token never trusted for authorization | ✅ | `get_current_user_and_org` returns `membership.role.value`; unit tests cover stale admin claim |
| D-3 | Refresh is single-flight (no self-invalidating rotation storm) | ✅ | Delete `access_token` cookie → exactly **1** `/auth/refresh`, session restored, stayed on `/documents`, no page errors |
| D-4 | Logged-out visitors do not loop on refresh | ✅ | 5 s failure cooldown + one-retry guard in `lib/api/client.ts`; 3 parallel 401s → 0 refresh calls. Unrecoverable 401s now route through `registerSessionExpiredHandler` (P1-U6, closed). |
| D-5 | Protected routes reject anonymous callers | ✅ | `/api/v1/documents`, `/api/v1/chat/favorites`, `/api/v1/admin/overview` → 401 |
| D-6 | Documents route survives Next's trailing-slash proxy | ✅ | `/api/v1/documents` **and** `/api/v1/documents/` both 200 (alias route added) |
| D-7 | Favourites never cross users or tenants | ✅ | Manual two-user probe + integration tests in B-4 |
| D-8 | Logout/role change invalidates refresh sessions | ✅ | Covered by the existing admin-user tests; token `jti` denylist is not implemented (accepted) |

### E · Security hardening

| # | Gate | Status | Evidence |
|---|---|---|---|
| E-1 | Production config fails fast | ✅ | Weak `JWT_SECRET_KEY` → exit 1 (`must be a real secret of at least 32 characters`); `ALLOWED_ORIGINS=*` → exit 1; valid prod config → exit 0 |
| E-2 | Cross-origin state-changing requests are refused | ✅ | Foreign-origin preflight → 400, no `access-control-allow-origin`; `CSRFOriginMiddleware` unit tests cover Origin/Referer/Bearer |
| E-3 | Security headers present | ✅ | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`, HSTS 2 years + preload, CSP `default-src 'self'; frame-ancestors 'none'` |
| E-4 | Login brute force is rate-limited | ✅ | 11 rapid bad logins → 429 on the 11th |
| E-5 | Request body size capped | ✅ | `RequestSizeLimitMiddleware`; 413 `PAYLOAD_TOO_LARGE` before the body is read |
| E-6 | Upload type/size allow-list | ✅ | `allowed_extensions` + `max_upload_size_mb` (50 MB default) in `core/config.py` |
| E-7 | Password-reset tokens are not logged | ✅ | `auth.py` logs `password_reset_token_issued` only — no token value |
| E-8 | Request IDs are server-generated and correlated | ✅ | `X-Request-ID` echoed on responses and bound to every structlog line |
| E-9 | Errors do not leak internals | ✅ | Typed `AppError` hierarchy returns `{error: {code, message, request_id}}`; unhandled exceptions log the trace but return a generic body |

### F · Observability and health

| # | Gate | Status | Evidence |
|---|---|---|---|
| F-1 | Liveness probe | ✅ | `/api/v1/health/live` → **200 in 9 ms** (re-verified 2026-11-21; no DB call) |
| F-2 | Readiness probe | ✅ | `/api/v1/health/ready` → 200: `database`, `embedding_model`, `redis`, **`celery`** all `ok` (re-verified 2026-11-21) |
| F-3 | Startup probe ties readiness to migrations | ✅ | `/api/v1/health/startup` → 200, `migrations: at_head:0004` |
| F-4 | Prometheus metrics exposed | ✅ | `/metrics` → 200; `http_requests_total`, `http_request_duration_seconds`, `rag_requests_total` present |
| F-5 | RAG stages are individually timed | ✅ | `rag_stage_duration_seconds` reports `load_context`, `embed_query`, `vector_search`, `keyword_search`, `fusion`, `rerank`, `retrieve`, `prompt_build`, `llm_generate` |
| F-6 | A slow answer is explainable | ✅ | One measured request: embed_query 1.09 s, retrieve 1.42 s, prompt_build 0.26 s, llm_generate 0.67 s — now fully attributable |
| F-7 | Route labels are templates, not raw paths | ✅ | `route="/api/v1/chat/favorites"`, no UUIDs in label values |
| F-8 | Dashboards + alert rules + SLOs | ⚠️ | Metrics are exported but nothing scrapes or alerts — see **O-2** |
| F-9 | Structured logs persisted to rotating `.log` files | ✅ | `core/logging.py` writes the same structlog JSON to stdout and `backend/logs/{backend,celery}.log`; `RotatingFileHandler` at 10 MiB × 5 backups. Verified by `tests/unit/test_logging.py` (3 passed, incl. rotation + redaction) and by live API/worker log files after restart. Config in `configuration-reference.md`. |

### G · Performance

| # | Gate | Status | Evidence |
|---|---|---|---|
| G-1 | Chat list query served by one index | ✅ | `(organization_id, user_id, is_active, updated_at)` composite |
| G-2 | Message pagination served by one index | ✅ | `(conversation_id, created_at)` composite |
| G-3 | Favourites query index-backed | ✅ | `(organization_id, user_id, created_at DESC)` |
| G-4 | Notification + feedback queues index-backed | ✅ | `(recipient_user_id, is_read, created_at)`, `(organization_id, review_status, created_at)` |
| G-5 | Vector search uses an index, not a seq scan | ✅ | At 0004: ivfflat `vector_cosine_ops` present and proven by `EXPLAIN`. In the Qdrant head this moves to a Qdrant payload-filtered collection (O-13). |
| G-6 | Keyword search index survives autogenerate | ✅ | `content_tsv` declared as `Computed` + GIN declared on the model |
| G-7 | No redundant network round-trips on auth failure | ✅ | Single-flight refresh + cooldown (D-3/D-4) |
| G-8 | Chat list does not re-render every bubble per keystroke | ✅ | Bubbles memoised; favourite/feedback callbacks wrapped in `useCallback` |
| G-9 | No duplicated favourite UI | ✅ | Welcome tile when the thread is empty; composer panel only when `messages.length > 0` |
| G-10 | 3× peak load test inside SLO | ⚠️ | Not executable here — no k6/Locust/Gatling installed (O-4) |
| G-11 | Cited answers measured on this machine | ✅ | `POST /api/v1/chat/ask` → 200, 1 citation, ~2.4 s wall |
| G-12 | Relevance gate parity between vector-only and keyword-only branches | ✅ | **Closed by G1.4:** both branches gated; unrelated question → 0 citations, relevant → 1, `gated_out` counter proves the filter ran |
| G-13 | `EXPLAIN` shows ivfflat and GIN indexes instead of seq scan + sort | ✅ | **Closed by G1.4:** ivfflat index scan 0.203 ms vs seq-scan+sort 12.577 ms at 8 004 rows; keyword branch uses `ix_chunks_content_tsv` (GIN) |

### H · Frontend release surface

| # | Gate | Status | Evidence |
|---|---|---|---|
| H-1 | Royal Glass is the default for everyone, including stale prefs | ✅ | `THEME_STORAGE_KEY` bumped to `fikra-theme-v2`; `DEFAULT_THEME = royal-glass` |
| H-2 | Only animated themes shipped | ✅ | 8 themes: `royal-glass`, `enchanted-dawn`, `blossom-breeze`, `arcane-midnight`, `ember-abyss`, `frozen-citadel`, `void-nebula`, `emerald-enigma` |
| H-3 | Anime artwork/companion fully removed | ✅ | `CompanionScene`, `NinjaArtwork`, `SoloArtwork`, `lib/companion.ts` and every `signalCompanion()` call deleted |
| H-4 | "System online" only on Settings | ✅ | `System online` count: 0 on `/chat`, 1 on `/settings` |
| H-5 | Royal-glass chat layout preserved | ✅ | AI glass card left, user pill right, citation chips with favicons, pill composer |
| H-6 | Favourites tile centred in a new conversation | ✅ | Tile centre 850 px = content column centre 850 px |
| H-7 | Tile click fills the composer without sending | ✅ | Textarea populated; user bubbles 0 |
| H-8 | Hide/show toggle controls the tile | ✅ | Surfaces: 1 → hide → 0 → show → 1 |
| H-9 | Starter prompts never duplicate a favourite | ✅ | With 1 favourite: 3 starters; with 0 favourites: 4 |
| H-10 | Empty favourites ⇒ no empty tile | ✅ | Surfaces 0 with zero favourites |
| H-11 | Star on an answer saves the question | ✅ | "Save question" → favourites list updated |
| H-12 | Existing thread shows the panel, not the tile | ✅ | `/chat?conversation=…`: 1 user pill, 1 AI card, 1 panel, welcome hidden |
| H-13 | Chat works end to end in the production bundle | ✅ | Question → persisted answer → reload lands on the same thread; 1 citation (`onboarding-sample`, p1, similarity 0.886), latency 2370 ms |
| H-14 | No page errors on the main routes | ✅ | `/chat`, `/settings`, `/documents`, `/analytics`, `/admin` → errors: none |
| H-15 | Error/not-found boundaries | ✅ | **O-8 closed:** `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/loading.tsx` added and browser-verified (G2.2) |
| H-16 | Expired sessions recover in-product (P1-U6) | ✅ | 401 surviving refresh → `registerSessionExpiredHandler` clears user and routes to `/login?session_expired=1`; notice rendered. No hard navigation. |
| H-17 | Conversation list is navigable by assistive tech (P1-U9) | ✅ | `role="list"` / `role="listitem"` and `aria-current` on the active row |
| H-18 | No native `confirm`/`prompt` dialogs (P1-U10) | ✅ | Shared accessible `Dialog` used for document delete, feedback comment and access request; `window.confirm`/`window.prompt` count 0 in `frontend/src` |

### I · Configuration and secrets

| # | Gate | Status | Evidence |
|---|---|---|---|
| I-1 | `.env` untouched by this release | ✅ | No edits to `backend/.env` or any secret file |
| I-2 | Prod-only guards documented | ✅ | `configuration-reference.md`; enforced in `Settings.validate_production_secrets`. Includes the Qdrant HTTPS → API-key guard. |
| I-3 | Dual browser/API auth is intentional | ✅ | HttpOnly cookies for browsers; Bearer for CLI clients (E-2 exempts Bearer) |
| I-4 | Rate limiter scope understood | ⚠️ | Sliding window lives in process memory; effective limit scales with worker count — see O-5 |

### J · Operations

| # | Gate | Status | Evidence |
|---|---|---|---|
| J-1 | Migration rollback rehearsed | ⚠️ | 0001→0004 rollback rehearsed clean (C-6). 0005 downgrade loses vectors by design and needs a reindex runbook — see O-13. |
| J-2 | Image rollback rehearsed | ⚠️ | Needs a registry + previous tag — see **O-3** |
| J-3 | Backup/restore rehearsed with RPO/RTO | ✅ | `pg_dump` → new DB → `pg_restore` → `alembic current` = `0004 (head)` (G3.x, 150 123-byte dump). The saved `backup_fikra_rag_prod.dump` has since been truncated to 0 bytes — regenerate it before repeating. RPO/RTO target still needs Ops sign-off. |
| J-4 | Docker images build and boot | ⚠️ | Docker CLI is not installed on this host. CI now has a `docker` job that builds backend/worker/frontend images, but it has not run remotely — see O-3/O-1. |
| J-5 | Health probes wired into the orchestrator | ⚠️ | `docker-compose.yml` wires healthchecks + `condition: service_healthy` for postgres, redis and backend; worker/frontend have no probe and there are no k8s manifests in the repo. |
| J-6 | Runbook per alert | ⚠️ | Depends on O-2 |

---

## 3. How to reproduce these checks

```powershell
# Backend, from backend/
..\.venv\Scripts\python.exe -c "import app.main"
..\.venv\Scripts\python.exe -m pytest tests/unit tests/tenant_isolation -q --override-ini=addopts= -p no:langsmith
$env:TEST_DATABASE_URL = "postgresql+asyncpg://postgres:root@127.0.0.1:5432/fikra_checklist_integration"
..\.venv\Scripts\python.exe -m pytest tests/integration -q --override-ini=addopts= -p no:langsmith
..\.venv\Scripts\alembic.exe heads
..\.venv\Scripts\alembic.exe current
..\.venv\Scripts\alembic.exe check
..\.venv\Scripts\ruff.exe check app/          # tests/ still has pre-existing findings (O-11)
..\.venv\Scripts\ruff.exe format --check app/
..\.venv\Scripts\mypy.exe app/

# Frontend, from frontend/
npm.cmd run type-check
npm.cmd run build
npm.cmd run start        # serve the production bundle on :3000

# Live probes
curl.exe -s http://127.0.0.1:8000/api/v1/health/live
curl.exe -s http://127.0.0.1:8000/api/v1/health/ready
curl.exe -s http://127.0.0.1:8000/api/v1/health/startup
curl.exe -s http://127.0.0.1:8000/metrics | Select-String "rag_stage_duration_seconds_sum"
```

> Do not run `alembic revision --autogenerate` to "fix" the current `alembic check` failure: the
> failure is an **unapplied 0005**, not model drift. Read O-13 and `phase-gates.md` §G3.x first.

---

## 4. Open items

| # | Item | Severity | Why it matters | Next action | Owner |
|---|---|---|---|---|---|
| O-1 | Remote CI enforcement not yet demonstrated | Medium | Workflow is committed with backend/frontend/docker/E2E jobs, but gate "CI blocks merges" is only proven by a real Actions run + branch protection | Push the branch (when authorised), confirm all four jobs green, require them in branch protection | Platform |
| O-2 | No alerting/SLOs | **High** | `/metrics` is scraped by nobody; a 5xx spike or a 10 s p95 is invisible | Ship Prometheus rules + Grafana dashboard for `http_request_duration_seconds` and `rag_stage_duration_seconds`; define p95 targets and a runbook link per alert | Ops |
| O-3 | Production image build/rollback not rehearsed | Medium | Restore rehearsal is done; a bad deploy still has no proven image rollback path | On a Docker-capable host (or via CI's `docker` job), build and boot all three images, tag a release, rehearse `docker compose` rollback; document RPO/RTO | Ops |
| O-4 | Load test at 3× peak | Medium | Capacity model is still an estimate | k6/Locust run against staging, targeting `POST /api/v1/chat/ask` with p50 ≤ 4 s / p95 ≤ 8 s at 3× peak | Platform |
| O-5 | Rate limiter is per-process | Low | With N workers the effective login limit is N × 10/min | Move the window to Redis, or document the per-worker limit in the config reference | Backend |
| O-7 | No ESLint config committed | Low | `npm run lint` prompts to create one; only `type-check` and `next build` lint run | Commit `eslint.config.mjs` (`next/core-web-vitals`) | Frontend |
| O-9 | `/chat` first load is 419 kB | Low | Largest route on a low-bandwidth link | Split the theme/artwork and markdown renderer behind `next/dynamic` | Frontend |
| O-11 | 124 ruff findings in `tests/` | Low | Noise hides new violations; `app/` is now clean | Add `-> None` to test methods and `datetime.UTC`; enable `--fix` in CI | Backend |
| O-13 | Qdrant cutover (0005) is in flight | **High** | Working tree moves embeddings to Qdrant and drops the pgvector column; live DB is at 0004, `alembic check` fails, no Qdrant service runs locally or in compose, and downgrade cannot restore vectors | Provision Qdrant (`QDRANT_URL`/`QDRANT_API_KEY`), add it to compose + CI services, apply 0005 on a scratch DB, re-run `alembic check`, all 157 tests and a cited-answer smoke test, document reindex-on-downgrade, then commit as a separate release | Backend / Platform |

### Closed since the 2026-11-18 assessment

| # | Item | Closed | Evidence |
|---|---|---|---|
| O-6 | `mypy` could not run in this venv | 2026-11-19 | 61 strict errors fixed; `mypy app/` → no issues in 64 files; step added to CI |
| O-8 | No `error.tsx` / `not-found.tsx` | 2026-11-18 | Route boundaries added and browser-verified in G2.2 (H-15) |
| O-10 | `embed_query` ≈ 1.09 s per question | 2026-11-19 | G1.4 measured 77 ms mean after the retrieval fix |
| O-12 | G1.4 performance gates open | 2026-11-19 | G1.4 PASS: p50 924 ms / p95 1262 ms, relevance parity, `EXPLAIN` index proof (G-12/G-13) |
| — | Backup/restore rehearsal (formerly part of O-3) | 2026-11-19 | Dump → restore → `alembic current` = head (J-3) |
| — | UI findings P1-U6 / P1-U9 / P1-U10 | 2026-11-19 | H-16 / H-17 / H-18; recorded in `phase-gates.md` §G2.2 open items |

---

## 5. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Engineering | | Approve staging deploy of the **0004 baseline** | |
| Engineering | | Approve production deploy (requires O-1, O-2, O-3 and O-13) | |
| Ops / SRE | | Confirm probes, alerting, backups, Qdrant service and load test | |
| Security | | Accept dual-token and per-process rate-limit posture | |
