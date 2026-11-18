# FIKRA AI — Production Readiness Checklist

**Release under test:** royal-glass chat redesign, per-user favourite questions, performance work
**Date:** 2026-11-18
**Companion documents:** [Production Readiness Plan](production-readiness-plan.md) (why each gate exists),
[Phase Gate Evidence Log](phase-gates.md) (append-only record of the security, schema, observability
and hardening gates), [Audit Findings Register](audit-findings.md) (defects with file:line),
[Security Checklist](security-checklist.md)

---

## 1. Verdict

| Audience | Verdict |
|---|---|
| **Staging deployment** | ✅ **Ready.** Every code, schema, test and configuration gate below passes on this machine. |
| **Production sign-off** | ⚠️ **Conditional.** All *application* gates pass. Three *operational* gates are still open: CI enforcement, alerting/SLOs, and backup/restore rehearsal; the G1.4 performance evidence (stage budgets, `EXPLAIN` proof, relevance-gate parity) is also still being collected. None of them is a defect in the shipped code, and none can be closed from a developer workstation. |

Nothing in section 2 is failing. The **High** and **Medium** items in **§4 Open items** must close, or be
accepted in writing, before the go-live signature; the Low items are tracked debt.

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Verified in this release, with the command and result recorded below |
| ⚠️ | Open — needs an owner outside this repository or a rehearsal that cannot run here |
| ⛔ | Blocking defect. **None.** |

---

## 2. Gate checklist

### A · Build and types

| # | Gate | Status | Evidence |
|---|---|---|---|
| A-1 | Backend imports cleanly | ✅ | `python -c "import app.main"` → `import ok` (exit 0) |
| A-2 | Frontend type-check passes | ✅ | `npm run type-check` (`tsc --noEmit`) → no output, exit 0 |
| A-3 | Frontend production build passes | ✅ | `npm run build` → `✓ Compiled successfully`, 13 static pages, exit 0 |
| A-4 | Production bundle actually serves | ✅ | `next start` on `127.0.0.1:3000`; `/login`, `/chat`, `/documents`, `/settings`, `/analytics`, `/admin` all 200 with no page errors |
| A-5 | Lint clean on changed backend files | ✅ | `ruff check` on `chat.py`, `documents.py`, `conversation.py`, `audit.py`, `config.py`, `dependencies.py`, `health.py`, `middleware.py`, new tests → only pre-existing findings remain |
| A-6 | Lint/format clean on changed frontend files | ✅ | Build's lint stage passed; no ESLint config is committed (see O-7) |
| A-7 | Static typing across backend | ⚠️ | `mypy` cannot start in this venv (`deprecated` package syntax error) — see O-6 |
| A-8 | Bundle sizes inspected | ✅ | `/chat` 288 kB route / 419 kB first load; shared JS 87.3 kB. Tracked as O-9 |

### B · Tests

| # | Gate | Status | Evidence |
|---|---|---|---|
| B-1 | Unit + tenant-isolation suites | ✅ | `pytest tests/unit tests/tenant_isolation -q` → **77 passed** (run 3× consecutively for stability) |
| B-2 | Integration suite on real PostgreSQL | ✅ | Scratch DB + `TEST_DATABASE_URL` → **55 passed** |
| B-3 | Tenant-isolation tests gate the two historical fail-opens | ✅ | `test_retrieval_access.py` proves the JWT `role` claim is never returned and a demoted admin is refused on the next request |
| B-4 | Favourite questions are isolated per user **and** per tenant | ✅ | New `tests/integration/test_favorite_questions_isolation.py`: same-org colleague sees `[]`, cross-tenant delete → 404, save is idempotent + whitespace-normalised |
| B-5 | Groq is mocked in unit tests (no live calls) | ✅ | Suite runs offline in ~2 s |
| B-6 | Chat stream persists citations + usage | ✅ | `test_chat_stream_analytics.py` (fake `RAGService`, real DB) passes |
| B-7 | Tests fail loudly, not silently, on schema drift | ✅ | Fixed two fixtures that still inserted `embedding = NULL` after `NOT NULL` landed, and a test double whose `__init__` no longer matched `RAGService` |
| B-8 | CI runs the suites on every push | ⚠️ | `.github/workflows/` is empty — see **O-1** |

### C · Database and migrations

| # | Gate | Status | Evidence |
|---|---|---|---|
| C-1 | Live DB at migration head | ✅ | `alembic current` → `0004 (head)` |
| C-2 | Models and DB agree (no autogenerate drift) | ✅ | `alembic check` → `No new upgrade operations detected` (exit 0). The former ~40 renames plus the would-be `content_tsv`/ivfflat drops are closed by `0004_schema_integrity.py` |
| C-3 | Fresh install from migrations alone | ✅ | Throwaway DB → `alembic upgrade head` exit 0, `alembic check` exit 0 |
| C-4 | Drift-sensitive objects survive a fresh install | ✅ | `content_tsv` `is_generated=ALWAYS`; GIN index 1; ivfflat index 1; `embedding` `is_nullable=NO` |
| C-5 | Hot-path indexes exist in a fresh install | ✅ | `ix_conversations_owner_active_updated`, `ix_messages_conversation_created`, `ix_notifications_recipient_read_created`, `ix_feedback_org_status_created`, `favorite_questions` table — all present |
| C-6 | Every migration is reversible | ✅ | Rehearsal on scratch DB: `upgrade head → downgrade base → upgrade head`, all exit 0, 17 tables restored |
| C-7 | Migrations run before the app serves traffic | ✅ | `/api/v1/health/startup` reports `migrations: at_head:0004` (503 until then) |
| C-8 | One favourite per question per user, enforced by the DB | ✅ | `0003` unique index on `(organization_id, user_id, question)`; concurrent duplicate handled by `IntegrityError` fallback |

### D · Auth, sessions and tenancy

| # | Gate | Status | Evidence |
|---|---|---|---|
| D-1 | Cookies are `HttpOnly`, `SameSite=strict`, `Secure` in production | ✅ | `auth.py` `set_cookie(... samesite="strict", secure=settings.is_production)` |
| D-2 | Access token never trusted for authorization | ✅ | `get_current_user_and_org` returns `membership.role.value`; unit tests cover stale admin claim |
| D-3 | Refresh is single-flight (no self-invalidating rotation storm) | ✅ | Delete `access_token` cookie → exactly **1** `/auth/refresh`, session restored, stayed on `/documents`, no page errors |
| D-4 | Logged-out visitors do not loop on refresh | ✅ | 5 s failure cooldown + one-retry guard in `lib/api/client.ts`; 3 parallel 401s → 0 refresh calls |
| D-5 | Protected routes reject anonymous callers | ✅ | `/api/v1/documents`, `/api/v1/chat/favorites`, `/api/v1/admin/overview` → 401 |
| D-6 | Documents route survives Next's trailing-slash proxy | ✅ | `/api/v1/documents` **and** `/api/v1/documents/` both 200 (alias route added); `/documents` page loads authenticated instead of bouncing to login |
| D-7 | Favourites never cross users or tenants | ✅ | Manual two-user probe + the integration tests in B-4 |
| D-8 | Logout/role change invalidates refresh sessions | ✅ | Covered by the existing admin-user tests; token `jti` denylist is not implemented (accepted, see §4 note) |

### E · Security hardening

| # | Gate | Status | Evidence |
|---|---|---|---|
| E-1 | Production config fails fast | ✅ | `APP_ENV=production` + weak `JWT_SECRET_KEY` → exit 1 (`must be a real secret of at least 32 characters`); `ALLOWED_ORIGINS=*` → exit 1; valid prod config → exit 0 |
| E-2 | Cross-origin state-changing requests are refused | ✅ | Foreign-origin preflight → **400**, no `access-control-allow-origin`; `CSRFOriginMiddleware` unit tests cover Origin/Referer/Bearer |
| E-3 | Security headers present | ✅ | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`, HSTS 2 years + preload, CSP `default-src 'self'; frame-ancestors 'none'` |
| E-4 | Login brute force is rate-limited | ✅ | 11 rapid bad logins → `... ,429` on the 11th |
| E-5 | Request body size capped | ✅ | `RequestSizeLimitMiddleware`; unit tests return 413 `PAYLOAD_TOO_LARGE` before reading the body |
| E-6 | Upload type/size allow-list | ✅ | `allowed_extensions` + `max_upload_size_mb` (50 MB default) in `core/config.py` |
| E-7 | Password-reset tokens are not logged | ✅ | `auth.py` logs `password_reset_token_issued` only — no token value |
| E-8 | Request IDs are server-generated and correlated | ✅ | `X-Request-ID` echoed on responses and bound to every structlog line |
| E-9 | Errors do not leak internals | ✅ | Typed `AppError` hierarchy returns `{error: {code, message, request_id}}`; unhandled exceptions log the trace but return a generic body |

### F · Observability and health

| # | Gate | Status | Evidence |
|---|---|---|---|
| F-1 | Liveness probe | ✅ | `/api/v1/health/live` → 200 in **3 ms** (no DB call) |
| F-2 | Readiness probe | ✅ | `/api/v1/health/ready` → 200 in **37 ms**: `database: ok`, `embedding_model: ok`, `redis: ok` |
| F-3 | Startup probe ties readiness to migrations | ✅ | `/api/v1/health/startup` → 200, `migrations: at_head:0004` |
| F-4 | Prometheus metrics exposed | ✅ | `/metrics` → 200; `http_requests_total`, `http_request_duration_seconds`, `rag_requests_total` present |
| F-5 | RAG stages are individually timed | ✅ | `rag_stage_duration_seconds` reports `load_context`, `embed_query`, `vector_search`, `keyword_search`, `fusion`, `rerank`, `retrieve`, `prompt_build`, `llm_generate` |
| F-6 | A slow answer is explainable | ✅ | One measured request: embed_query **1.09 s**, retrieve **1.42 s**, prompt_build **0.26 s**, llm_generate **0.67 s**, total ≈ **3.4 s** — the former "missing 10 s" is now attributable |
| F-7 | Route labels are templates, not raw paths | ✅ | `route="/api/v1/chat/favorites"`, no UUIDs in label values |
| F-8 | Dashboards + alert rules + SLOs | ⚠️ | Metrics are exported but nothing scrapes or alerts — see **O-2** |

### G · Performance

| # | Gate | Status | Evidence |
|---|---|---|---|
| G-1 | Chat list query served by one index | ✅ | `(organization_id, user_id, is_active, updated_at)` composite |
| G-2 | Message pagination served by one index | ✅ | `(conversation_id, created_at)` composite |
| G-3 | Favourites query index-backed | ✅ | `(organization_id, user_id, created_at DESC)` |
| G-4 | Notification + feedback queues index-backed | ✅ | `(recipient_user_id, is_read, created_at)`, `(organization_id, review_status, created_at)` |
| G-5 | Vector search uses an index, not a seq scan | ✅ | ivfflat `vector_cosine_ops` present after a fresh install |
| G-6 | Keyword search index survives autogenerate | ✅ | `content_tsv` declared as `Computed` + GIN declared on the model |
| G-7 | No redundant network round-trips on auth failure | ✅ | Single-flight refresh + cooldown (D-3/D-4) |
| G-8 | Chat list does not re-render every bubble per keystroke | ✅ | Bubbles memoised; favourite/feedback callbacks wrapped in `useCallback` |
| G-9 | No duplicated favourite UI | ✅ | Welcome tile when the thread is empty; composer panel only when `messages.length > 0` |
| G-10 | 3× peak load test inside SLO | ⚠️ | Not executable here — see **O-4** |
| G-11 | Cited answers measured on this machine | ✅ | `POST /api/v1/chat/ask` → 200, 1 citation, ~2.4 s wall; the 3.4 s figure in F-6 includes the first-request model warm-up |
| G-12 | Relevance gate parity between vector-only and keyword-only branches | ⚠️ | Tracked as G1.4 item 2 in [Phase Gate Evidence Log](phase-gates.md) — see O-12 |
| G-13 | `EXPLAIN` shows the ivfflat and GIN indexes instead of seq scan + sort | ⚠️ | Tracked as G1.4 item 3 — see O-12 |

### H · Frontend release surface

| # | Gate | Status | Evidence |
|---|---|---|---|
| H-1 | Royal Glass is the default for everyone, including stale prefs | ✅ | `THEME_STORAGE_KEY` bumped to `fikra-theme-v2`; `DEFAULT_THEME = royal-glass` |
| H-2 | Only animated themes shipped | ✅ | 8 themes: `royal-glass`, `enchanted-dawn`, `blossom-breeze`, `arcane-midnight`, `ember-abyss`, `frozen-citadel`, `void-nebula`, `emerald-enigma` |
| H-3 | Anime artwork/companion fully removed | ✅ | `CompanionScene`, `NinjaArtwork`, `SoloArtwork`, `lib/companion.ts` and every `signalCompanion()` call deleted |
| H-4 | "System online" only on Settings | ✅ | `System online` count: **0** on `/chat`, **1** on `/settings` |
| H-5 | Royal-glass chat layout preserved | ✅ | Screenshot verified: AI glass card left, user pill right, citation chips with favicons, pill composer |
| H-6 | Favourites tile centred in a new conversation | ✅ | Tile centre **850 px** = content column centre **850 px** |
| H-7 | Tile click fills the composer without sending | ✅ | Textarea populated; user bubbles **0** |
| H-8 | Hide/show toggle controls the tile | ✅ | Surfaces: 1 → hide → **0** → show → **1** |
| H-9 | Starter prompts never duplicate a favourite | ✅ | With 1 favourite: **3** starters and no duplicate; with 0 favourites: **4** starters |
| H-10 | Empty favourites ⇒ no empty tile | ✅ | Surfaces **0** with zero favourites |
| H-11 | Star on an answer saves the question | ✅ | "Save question" → favourites `["What is the onboarding process?", "Which documents cover compliance?"]` |
| H-12 | Existing thread shows the panel, not the tile | ✅ | `/chat?conversation=…`: 1 user pill, 1 AI card, 1 favourite surface (panel above composer), welcome hidden |
| H-13 | Chat works end to end in the production bundle | ✅ | Question → persisted answer → reload lands on the same thread. A document-relevant question returns a cited answer: `retrieved_count` > 0, 1 citation (`onboarding-sample`, page 1, similarity **0.886**), `latency_ms` 2370 in a 2429 ms wall time |
| H-14 | No page errors on the main routes | ✅ | `/chat`, `/settings`, `/documents`, `/analytics`, `/admin` → `errors: none` |
| H-15 | Error/not-found boundaries | ⚠️ | No `app/error.tsx` / `app/not-found.tsx`; Next's default page is used — see O-8 |

### I · Configuration and secrets

| # | Gate | Status | Evidence |
|---|---|---|---|
| I-1 | `.env` untouched by this release | ✅ | No edits to `backend/.env` or any secret file |
| I-2 | Prod-only guards documented | ✅ | `configuration-reference.md`; enforced in `Settings.validate_production_secrets` |
| I-3 | Dual browser/API auth is intentional | ✅ | HttpOnly cookies for browsers; Bearer for CLI clients, which keeps the login body token by design (E-2 exempts Bearer) |
| I-4 | Rate limiter scope understood | ⚠️ | Sliding window lives in process memory; effective limit scales with worker count — see O-5 |

### J · Operations

| # | Gate | Status | Evidence |
|---|---|---|---|
| J-1 | Migration rollback rehearsed | ✅ | C-6 |
| J-2 | Image rollback rehearsed | ⚠️ | Needs a registry + previous tag — see **O-3** |
| J-3 | Backup/restore rehearsed with RPO/RTO | ⚠️ | No backup job or restore runbook in this repo — see **O-3** |
| J-4 | Docker images build and boot | ⚠️ | `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` exist; Docker is unavailable on this machine — see O-3 |
| J-5 | Health probes wired into the orchestrator | ⚠️ | Endpoints exist (F-1…F-3); compose/k8s probe wiring not verified here |
| J-6 | Runbook per alert | ⚠️ | Depends on O-2 |

---

## 3. How to reproduce these checks

```powershell
# Backend, from backend/
..\.venv\Scripts\python.exe -c "import app.main"
..\.venv\Scripts\python.exe -m pytest tests/unit tests/tenant_isolation -q --override-ini=addopts=
$env:TEST_DATABASE_URL = "postgresql+asyncpg://.../fikra_test"   # unused by default (SQLite)
..\.venv\Scripts\python.exe -m pytest tests/integration -q --override-ini=addopts=
..\.venv\Scripts\alembic.exe current
..\.venv\Scripts\alembic.exe check
..\.venv\Scripts\ruff.exe check app/ tests/

# Frontend, from frontend/
npm.cmd run type-check
npm.cmd run build
npm.cmd run start        # serve the production bundle on :3000

# Live probes
curl.exe -s -o NUL -w "%{http_code} %{time_total}s`n" http://127.0.0.1:8000/api/v1/health/live
curl.exe -s http://127.0.0.1:8000/api/v1/health/ready
curl.exe -s http://127.0.0.1:8000/metrics | Select-String "rag_stage_duration_seconds_sum"
```

> Do not run `alembic revision --autogenerate` to "fix" drift before reading
> `production-readiness-plan.md` §WS-3: the models now declare `content_tsv`, the GIN index and the
> ivfflat index, and an unguarded autogenerate would drop them.

---

## 4. Open items

| # | Item | Severity | Why it matters | Next action | Owner |
|---|---|---|---|---|---|
| O-1 | No CI pipeline | **High** | Suites pass only when a human remembers to run them; the two historical P0s can regress silently | Add `.github/workflows/ci.yml`: ruff, pytest (unit + tenant-isolation), Postgres service for integration, `tsc --noEmit`, `next build` | Platform |
| O-2 | No alerting/SLOs | **High** | `/metrics` is scraped by nobody; a 5xx spike or a 10 s p95 is invisible | Ship Prometheus rules + Grafana dashboard for `http_request_duration_seconds` and `rag_stage_duration_seconds`; define p95 targets and a runbook link per alert | Ops |
| O-3 | No backup/restore or image rollback rehearsal | **High** | A bad deploy or data loss has no proven recovery path | Schedule nightly `pg_dump` + restore drill; document RPO/RTO; tag images and rehearse `docker compose` rollback | Ops |
| O-4 | Load test at 3× peak | Medium | Capacity model is still an estimate; the CPU-bound embedding stage is the suspect | k6/Locust run against staging, watch `embed_query` and `llm_generate` stage SLOs | Platform |
| O-5 | Rate limiter is per-process | Low | With N workers the effective login limit is N × 10/min | Move the window to Redis, or document the per-worker limit in the config reference | Backend |
| O-6 | `mypy` cannot run in this venv | Medium | The strict type gate is effectively off | Pin a compatible `mypy`/`deprecated` pair, then add it to CI (O-1) | Backend |
| O-7 | No ESLint config committed | Low | `npm run lint` prompts to create one; only `type-check` and `next build` lint run | Commit `eslint.config.mjs` (`next/core-web-vitals`) | Frontend |
| O-8 | No `error.tsx` / `not-found.tsx` | Low | A render error shows Next's default page instead of in-product recovery | Add a branded error boundary with a "Retry" action and request-id display | Frontend |
| O-9 | `/chat` first load is 419 kB | Low | Largest route on a low-bandwidth link | Split the theme/artwork and markdown renderer behind `next/dynamic` | Frontend |
| O-10 | `embed_query` ≈ 1.09 s per question | Low | Dominates the 3.4 s answer path on CPU | Warm the model at boot (done) + evaluate ONNX/int8 or a query-embedding cache for repeats | Backend |
| O-11 | 15 pre-existing ruff findings in integration tests | Low | Noise hides new violations | Add `-> None` to test methods and `datetime.UTC`; enable `--fix` in O-1's CI | Backend |
| O-12 | G1.4 performance gates still open | Medium | p50/p95 stage budgets, relevance-gate parity, and `EXPLAIN` index proof are not yet recorded | Close the three items in [Phase Gate Evidence Log](phase-gates.md) §"Open items for the next gate (G1.4)" and append the results there | Backend |

---

## 5. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Engineering | | Approve staging deploy | |
| Engineering | | Approve production deploy (requires O-1…O-3) | |
| Ops / SRE | | Confirm probes, alerting, backups | |
| Security | | Accept dual-token and per-process rate-limit posture | |
