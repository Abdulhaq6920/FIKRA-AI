# FIKRA AI — Audit Findings Register

**Date:** 2026-11-15
**Scope:** full application audit — backend (FastAPI), frontend (Next.js 14), data layer,
deployment config, observability, API security.
**Method:** static reading of every source file + live runtime verification against the running
stack (PostgreSQL 18 + pgvector, Redis, uvicorn, `next dev`) + `alembic check` + `next build` +
`pytest`.

Every finding below was verified against the code and/or a live run. Line numbers refer to the
state of the repo on the audit date.

---

## 0. Live runtime baseline (measured, not estimated)

| Check | Result |
|---|---|
| `GET /api/v1/health/ready` | `200 {"status":"ready","checks":{"database":"ok","redis":"ok"}}` |
| `next build` (production) | ✅ passes, 0 type errors, 13 routes |
| `pytest tests/unit tests/tenant_isolation` | ✅ 59 passed |
| `alembic current` | `0003 (head)` |
| `alembic check` (drift) | ❌ **fails — large drift, see P0-6** |
| Login → `/auth/me` → conversations → documents → notifications | ✅ all 200 |
| `POST /chat/ask` (cold) | 15 232 ms |
| `POST /chat/ask` (warm) | 11 540 ms / 12 486 ms |
| Groq call inside that request | **981 ms** |
| `embed_query` (measured directly) | 772 ms |
| `rerank` 12 × ~1 000 chars (measured directly) | 3 840 ms |
| `next build` bundle — `/chat` first load | **418 kB** (287 kB page route) |

> The RAG request spends **~1 s in the LLM and ~11 s elsewhere**, and nothing in the logs tells
> you where. That single sentence is the strongest argument for the observability work in the
> plan.

---

## 1. P0 — release blockers

### P0-1 · Restricted documents leak into retrieval (critical security)

**`backend/app/services/retrieval_service.py:166` and `:229`**

```python
.where(
    ...
    access_condition or true(),
)
```

`access_condition` is a SQLAlchemy `BinaryExpression`. SQLAlchemy deliberately makes
`bool(BinaryExpression)` evaluate to **False**, so `access_condition or true()` **always**
evaluates to `true()` and the `access_level = 'organization'` predicate is **never emitted**.

Verified in this repo's venv:

```
bool(cond) = False
SQL: SELECT documents.id FROM documents WHERE documents.organization_id IS NULL
```

**Impact:** a normal member (`include_restricted=False`, set at `chat.py:213` / `:334`) retrieves
chunks from `access_level='restricted'` documents. Their text lands in the prompt, in
`Citation.excerpt`, in `messages.citations` JSONB, and in admin drill-downs. `documents.py:288`
and `:431` still block list/download, so the leak is chat-only — which is exactly where the
content is exposed.

**Fix:** build the predicate list explicitly; never use `or` on SQL expressions.

```python
conditions = [
    DocumentChunk.organization_id == organization_id,
    Document.organization_id == organization_id,
    Document.status == DocumentStatus.READY,
    Document.is_active == True,
]
if (access_condition := _access_scope_condition(include_restricted)) is not None:
    conditions.append(access_condition)
```

**Regression test (required):** a `RESTRICTED` chunk must not be returned for
`include_restricted=False`. There is currently **zero** `access_level` coverage in `tests/`.

---

### P0-2 · Authorization trusts the JWT role claim, not the database

**`backend/app/api/dependencies.py:98, 111-121, 140-143`**

The membership row is loaded but discarded — the function returns `role_str` from the token:

```python
membership = await db.scalar(select(OrganizationMembership).where(...))
if membership is None:
    raise PermissionDeniedError(...)
return user, org_id, role_str        # ← claim, not membership.role
```

`require_org_admin` then authorizes on that claim. Role changes are not revoked
(`admin_users.py:267-281` only revokes sessions on `is_active=False`).

**Impact:** demoting an org admin leaves them with full admin powers for up to
`ACCESS_TOKEN_EXPIRE_MINUTES` (30 min): user creation, role assignment, password reset of other
members, access-request approval (which grants admin to third parties), restricted-document
download, and analytics drill-down. Fail-open on a privilege boundary.

**Fix:** `return user, org_id, membership.role.value`; revoke refresh sessions on role change;
add a `jti` denylist in Redis for immediate access-token revocation.

---

### P0-3 · Password-reset token written to production logs

**`backend/app/api/v1/auth.py:216-224`**

```python
if settings.debug:
    logger.warning("dev_password_reset_token", token=token)
```

`debug` is independent of `app_env` (`config.py:32`) and nothing rejects `DEBUG=true` in
production. One mis-set flag turns every reset into account takeover for anyone with log access,
and `password-reset/initiate` is unauthenticated (5/hour per IP, per process).

**Fix:** never log the token. Ship a real mail provider adapter or log only
`sha256(token)[:12]`, gated on a dedicated non-production flag. Make the production validator
reject `DEBUG=true`.

---

### P0-4 · Migration/model drift — next `--autogenerate` will break the app

**`alembic check` output vs `backend/app/db/models/document.py`**

The live schema has a `content_tsv` generated column + GIN index and an ivfflat index that the
ORM metadata does not declare:

```
document_chunks.content_tsv  tsvector  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
"ix_chunks_content_tsv" gin (content_tsv)
"ix_chunks_embedding_ivfflat" ivfflat (embedding vector_cosine_ops) WITH (lists='100')
```

`alembic check` reports, among ~60 other differences:

* `('remove_column', None, 'document_chunks', Column('content_tsv', TSVECTOR(), ...))`
* `('remove_index', Index('ix_chunks_embedding_ivfflat', ...))`
* every index renamed `ix_<table>_<col>` → `ix_<short>_<col>` (the ORM `Base` declares no
  `naming_convention`, so autogenerate generates new names for existing objects)
* `uq_user_email` / `uq_user_email_normalized` "removed" and re-added as unique indexes

**Impact:** the next `alembic revision --autogenerate` produces a migration that **drops
`content_tsv` and the GIN index** (keyword search dies: `retrieval_service.py:216, 226` selects
and filters on it) and **drops the vector index** (every chat becomes a full seq scan + sort).
Also: the migration chain no longer describes the schema, so a fresh environment built from
migrations will not match the running one.

**Fix**
1. Add `content_tsv` and the two indexes to the models (`Computed(...)`, `Index(..., postgresql_using="gin"/"ivfflat")`).
2. Add a `MetaData(naming_convention=...)` block to `db/base.py` matching the **existing** names,
   then re-run `alembic check` until clean.
3. Commit a no-op `alembic revision --autogenerate` **only after** check is clean.
4. Add `alembic check` as a CI gate (see plan, Phase 2).

---

### P0-5 · Frontend production Docker image cannot build

**`frontend/Dockerfile` vs `frontend/next.config.mjs`**

```dockerfile
COPY --from=builder /app/.next/standalone ./
```

`next.config.mjs` never sets `output: "standalone"`. Verified: after a successful `next build`,
`frontend/.next/standalone` **does not exist** → the `production` stage fails at `COPY`.

**Fix:** add `output: "standalone"` to `next.config.mjs` (and drop the runtime `public/` copy if
unused), or switch the runtime stage to `npm run start`.

---

### P0-6 · Restricted-document filter absence has a sibling: `NULL` embedding crashes chat

**`backend/app/services/retrieval_service.py:183-186`**

`DocumentChunk.embedding` is nullable (`models/document.py:117`). `1 - NULL` is `NULL`,
`ORDER BY score DESC` puts `NULLS FIRST`, and `float(row.score)` raises `TypeError` → uncaught
→ 500 for **every** user of that tenant until the row is fixed.

**Fix:** `WHERE DocumentChunk.embedding.is_not(None)` + `if row.score is None: continue`, then
backfill and set `NOT NULL`.

---

### P0-7 · Document ingestion can freeze the whole API

**`backend/app/api/v1/documents.py:230-232, 473-589`**

The inline fallback (taken whenever Redis/Celery hiccups — `documents.py:223`) runs
`extract_text` (PyMuPDF + OCR), `chunk_text` (tiktoken) and `embed_chunks` (torch) **on the
event loop**, with no `to_thread`. Retrieval correctly offloads (`retrieval_service.py:77, 107`);
ingestion does not. A 200-page scanned PDF blocks logins, chat and health checks for minutes.

Two more ingestion state bugs on the same path:
* **`workers/document_tasks.py:112-117`** — `MaxRetriesExceededError` never fires when `exc=` is
  passed to `retry()`; the `_mark_failed` branch is dead code, so a document stays `PROCESSING`
  **forever** and is permanently excluded from retrieval (`retrieval_service.py:164`).
* **`workers/document_tasks.py:48-55, 96-99`** — `SoftTimeLimitExceeded` interrupts
  `run_until_complete` from the main thread; the `async with AsyncSessionLocal()` never exits →
  the asyncpg connection is never returned. Five timeouts exhaust `pool_size=5`.

**Fix:** wrap extraction/chunking/embedding in `asyncio.to_thread`; run each task with
`asyncio.run()`; catch the original exception and fail the document when retries are exhausted;
add a reconciler that fails documents stuck in `PROCESSING` for > N minutes.

---

### P0-8 · `onError`/`error.tsx`/`loading.tsx` do not exist — one bad date blanks the app

`frontend/src/app/` contains only pages, two layouts and `globals.css`. There is no
`error.tsx`, `global-error.tsx`, `not-found.tsx` or `loading.tsx` anywhere. Any render error
(e.g. `InsightUi.formatDateTime` on a malformed date) produces a **white screen** with no
recovery path. All 13 routes are client components; `next build` marks every route `○ (Static)`,
which confirms there is no server-side guard.

---

## 2. P1 — must fix before general availability

### Security

| # | Location | Issue | Fix |
|---|---|---|---|
| P1-S1 | `auth.py:129-133, 199-203` | Access token returned in the **JSON body** *and* set as an HttpOnly cookie — the cookie-only design is defeated (any XSS reads the response). | Return `{token_type, expires_in}` only for browser clients. |
| P1-S2 | `middleware.py` / `main.py` | **No CSRF defence** beyond `SameSite=strict`; no `Origin`/`Referer` check, no double-submit token. `secure=settings.is_production` → staging over HTTP ships auth cookies without `Secure`. Sibling-subdomain CSRF is still possible. | Origin allowlist middleware for unsafe methods; always `Secure` outside localhost; `__Host-` cookie prefixes. |
| P1-S3 | `documents.py:154-182, 437-444` | Detected MIME is computed then **never validated**, and played back to the browser. `html`/`htm` are on the extension allowlist → stored XSS if `Content-Disposition` is ever dropped. | `ALLOWED_MIME_BY_EXT` map; serve downloads as `application/octet-stream` for non-PDF/images; add `CSP: sandbox`. |
| P1-S4 | `documents.py:129-143` | Upload size is counted *after* Starlette already spooled the multipart body. No `Content-Length` pre-check, no body-size middleware → disk-fill from 5 × N GB per minute. | Reject `Content-Length > max + slack` with **413** before routing; `FileTooLarge` should be 413 not 400 (`exceptions.py:42`). |
| P1-S5 | `ingestion_service.py:124, 217, 380` | No decompression/OCR/PDF caps. A 50 MB `.xlsx`/`.png`/`.pdf` can decompress to GBs inside the API process. | `Image.MAX_IMAGE_PIXELS`, `read_excel(nrows=...)`, PDF page cap, zip entry-size sum cap. |
| P1-S6 | `main.py:132-143, 153` | Rate limiting covers 6 paths only (no `/admin/*`, `/documents/{id}/reindex`, `/chat/feedback`, `/access-requests`, `/analytics/*`), is **per-process** in memory, and keys on `request.client.host` with no `X-Forwarded-For` handling → behind a proxy **every user shares one bucket**. | Redis sliding window keyed by `user_id or trusted client IP`; extend the policy list; `--proxy-headers` + trusted-proxy allowlist. |
| P1-S7 | `config.py:83, 277-290` | `jwt_secret_key` defaults to a **random per-process** value and the production validator accepts it. Forgetting the env var boots fine, then every worker mints unverifiable tokens and every restart logs everyone out. | Default to a sentinel `CHANGE_ME…` that production rejects. Validate `DATABASE_URL`, `ALLOWED_ORIGINS`, `DEBUG=false` too. |
| P1-S8 | `admin.py:212, 285`; `documents.py:243` | Unvalidated path/query params → **500s**: `feedback_id: str`, `request_id: str` compared against `UUID`; `status: str` compared against a native PG enum. | `uuid.UUID` / `DocumentStatus` annotations → 422. |
| P1-S9 | `auth_service.py:245-258` | Refresh picks **an arbitrary** membership (no org predicate, no ordering): a two-org user can be silently re-scoped into the wrong tenant on refresh. | Store `organization_id` on `RefreshSession`; re-validate that exact membership. |
| P1-S10 | `auth_service.py:219-238` | Refresh rotation is read-then-write (no `SELECT … FOR UPDATE`) → two concurrent replays of a stolen token both succeed. No reuse detection. Expired sessions are never cleaned up. | `UPDATE … WHERE is_revoked=false RETURNING id`; revoke the family on reuse; add a cleanup job. |
| P1-S11 | `admin_users.py:196-198` | Cross-tenant **email-existence oracle** via `POST /admin/users` 409. | Uniform response/timing. |
| P1-S12 | `admin.py:283-330` | Privilege grants are **not audited** (role changes are). Approval of an access request promotes a user to org admin with no `AuditLog` row. | Write `AuditLog` on grant/revoke, feedback review, document delete. |
| P1-S13 | `auth_service.py:171-183` | Timing oracle: unknown email skips Argon2 entirely (~50-200 ms delta). | Verify a dummy hash when the user is missing; unify messages. |
| P1-S14 | `main.py:177-178` | `RequestValidationError` keeps FastAPI's default handler → bypasses the documented error envelope **and echoes submitted values** (including `LoginRequest.password`) to the caller and any body-logging proxy. | Register a handler returning `{error:{code,message,request_id,details}}` with `loc`/`msg` only. |
| P1-S15 | `auth.py:44-58` | Unauthenticated `/auth/signup-options` enumerates tenant UUIDs and names. Login itself requires a pasted org **UUID**. | Opaque slug + workspace picker; never expose the UUID as a login selector. |

### Correctness / logic

| # | Location | Issue | Fix |
|---|---|---|---|
| P1-L1 | `retrieval_service.py:104-122` | `min_relevance_score` is **skipped entirely when the reranker is on** (the default). Negative-logit chunks always fill the prompt. | Apply a sigmoid threshold on rerank scores too; gate keyword-only hits on `ts_rank`. |
| P1-L2 | `retrieval_service.py:149-170` | `ORDER BY 1 - (embedding <=> $1) DESC` is **not index-usable** by `vector_cosine_ops` → seq scan + sort over all chunks, every message. Tenant filter is a post-filter (filtered-ANN recall cliff). `lists=100` was created on an empty table; `probes` never set. | `ORDER BY embedding <=> $1 ASC LIMIT k`; switch to HNSW; `SET LOCAL` probes/ef_search; consider per-tenant partitioning. |
| P1-L3 | `retrieval_service.py:263-280` | RRF fusion **mutates** the passage objects shared with the vector list (aliasing) — scores depend on call order. | Build new objects during fusion. |
| P1-L4 | `chat.py:336-346, 429-432` | On cancel/disconnect the answer is **discarded** (no message, no `UsageRecord`) even though it was generated and billed; `yield` inside `finally` raises `RuntimeError`; `_cancel_events` is a per-process dict keyed by `user:conversation` (two tabs collide; multi-replica breaks). | Persist partial answers with `finish_reason='cancelled'`; never yield from `finally`; key on a server-issued `stream_id`; Redis flag for multi-replica. |
| P1-L5 | `chat.py:207-256` | The user message is inserted **after** the provider call, in the same transaction → a provider failure rolls back the question (client sees it, DB doesn't) and writes no usage row. `UsageRecord.error_category` is declared but never assigned. | Persist the question first; write an error usage row in `except`. |
| P1-L6 | `rag_service.py:402-428` | History builder can drop the previous **user** turn while keeping a clipped assistant turn → follow-ups lose their referent. | Keep the question when clipping the answer. |
| P1-L7 | `rag_service.py:450-465` | Prompt budget overflow only drops history; context/question are never trimmed and `max_input_tokens` is dead config. Pathological input → provider 400 → generic 503. | Enforce a real token budget; trim lowest-ranked passages; fail fast with 422. |
| P1-L8 | `documents.py:207-232` | `try` wraps `apply_async` **and** the DB flush → a post-publish flush failure starts the inline pipeline *in addition to* the queued task. Two pipelines `DELETE`+`INSERT` chunks → duplicates. No `UNIQUE(document_id, chunk_index)` to stop it. | Narrow the `try`; add the unique constraint; add an idempotency guard. |
| P1-L9 | `documents.py:357-392` | Re-index has no in-flight guard, sets `status=QUEUED` **before** dispatch (document disappears from retrieval for the whole run), and `apply_async` is called **before** `commit()`. | Use `REINDEXING` (enum value exists, unused); keep `status IN (READY, REINDEXING)` retrievable; 409 on concurrent re-index. |
| P1-L10 | `documents.py:326-344, 347-353` | Document delete loads **every cited message in the org** into Python; `storage.delete()` happens **before** `db.delete(doc)`/commit → a failed commit leaves a DB row whose file is gone. | Single SQL `jsonb` update; delete DB row first, file after commit (or outbox/GC). |
| P1-L11 | `insights_service.py:111-149, 345-408, 591-629` | Soft-deleted conversations are still counted and readable in `/admin/questions` and in the user's own analytics. | Add `Conversation.is_active` to every message aggregate. |
| P1-L12 | `insights_service.py:760-864` | 8 correlated aggregate subqueries per user row → ~160 full scans of `messages` per `/admin/analytics` request. `_document_citation_count` unnest-s JSONB per document × per message. | One `GROUP BY user_id` + lateral join; materialised `document_citations` table or nightly rollup. |
| P1-L13 | `insights_service.py:218-267` | `date_trunc('day', created_at)` is evaluated in the session time zone while keys are built from UTC → buckets shift on non-UTC servers. The last bucket is always partial. | `date_trunc('day', created_at AT TIME ZONE 'UTC')` and emit an explicit `since/until`. |
| P1-L14 | `insights_service.py:673-683` | Usage fallback can pick **another message's** usage row (no `message_id IS NULL` predicate) → wrong tokens/latency in drill-downs. | Add the predicate or backfill `usage_records.message_id`. |
| P1-L15 | `documents.py:115-234` | Upload buffers the whole file (2× size in RAM), hashes 50 MB on the loop, and writes to storage **before** the DB insert → orphaned files on failure. `checksum_sha256` is computed "for dedupe" but never compared. | Stream to temp file; `to_thread` the hash; insert first or clean up on failure. |
| P1-L16 | `workers/document_tasks.py:156-161` | Job lookup has **no `ORDER BY`** → the worker mutates an arbitrary job row; re-index creates no job and reuses a `SUCCESS` row; `attempt_number` never increments. | `ORDER BY created_at DESC LIMIT 1`; create a job per run; maintain attempt state. |
| P1-L17 | `db/models/*.py` | Missing composite indexes for the hottest queries: `messages(conversation_id, created_at)`, `messages(organization_id, created_at, role)`, `messages(organization_id, user_id, role)`, `usage_records(organization_id, created_at)`, `usage_records.message_id` (no index, no FK), `documents(organization_id, created_at)`, `notifications(organization_id, recipient_user_id, created_at)`. Missing uniques: `document_chunks(document_id, chunk_index)`, `feedback(message_id, user_id)`, `documents(organization_id, checksum_sha256)`. | One Alembic revision. |
| P1-L18 | `organization.py:56-58` vs `audit.py:37-42` | `Organization.audit_logs` uses `cascade="all, delete-orphan"` while the FK is `ON DELETE SET NULL` → deleting an org via the ORM deletes its **audit log**, contradicting "audit logs are never deleted". | `cascade="save-update"`, `passive_deletes=True`. |
| P1-L19 | `providers/groq_client.py:271-277` | The concurrency semaphore is held for the **entire stream**, with no acquire timeout → the (max+1)-th chat hangs indefinitely; retries re-enter the semaphore and amplify 429 storms. | `asyncio.wait_for(acquire, timeout)` → 503 + `Retry-After`; release after first token. |
| P1-L20 | `providers/ollama_client.py:91` | New `httpx.AsyncClient` per call, no retries, semaphore held for the whole stream. | One module-level client closed in `lifespan`; same retry policy as Groq. |

### UI / UX

| # | Location | Issue | Fix |
|---|---|---|---|
| P1-U1 | `AppShell.tsx:137` + `chat/page.tsx:514, 647` | `fikra:conv-refresh` is dispatched on new conversation / stream end but **nothing listens** → the new conversation never appears in the sidebar. `conversationRefreshTrigger` is never passed by `(protected)/layout.tsx:40`. | Subscribe in `AppShell` (or lift the list into a context) and delete the dead prop. |
| P1-U2 | `login/page.tsx:306-315` | **"Remember me" is a dead checkbox** — no state, not registered, no API effect. | Remove it or implement `remember` end-to-end. |
| P1-U3 | `login/page.tsx:192, 333` | The Log in button is disabled while `/auth/signup-options` loads and **stays disabled forever if that call fails** (`!defaultOrgId`) — a sign-up endpoint outage blocks sign-in. | Never gate login on org options. |
| P1-U4 | `features/auth/AuthShell.tsx:105` (+ hidden inputs) | Login always authenticates against `organizations[0]`; there is no workspace picker. Multi-tenant users cannot reach their other orgs. | Workspace select when `length > 1`, or resolve org by email domain server-side. |
| P1-U5 | `chat/page.tsx:392-394, 835-848`; `documents/page.tsx:62-64` | A fetch failure renders the **empty state** ("Welcome…", "No documents yet"), so an outage looks like an empty tenant. | Separate `error` from `empty`; add Retry. |
| P1-U6 | `client.ts:50-74` | Unrecoverable 401 does `window.location.href = "/login?session_expired=1"` — a full reload that destroys in-flight streams — and `session_expired` is **never read**. | `router.replace` via a callback + a real "session expired" notice. |
| P1-U7 | `features/auth/AuthContext.tsx:51-58` | `refresh()` catches **everything** and nulls the user → a transient 500/network blip logs the user out. | Only null on `401`. |
| P1-U8 | `admin/page.tsx:746, 757, 854, 865`; `AppShell.tsx:198-217` | Mutation failures are swallowed (`catch { /* ignore */ }`), and `performDelete`/rename mutate state even when the API failed → the UI lies. | Toast + revert on failure. |
| P1-U9 | `AppShell.tsx:722-731, 763` | Conversation rows are `<div onClick>` (not focusable, no `aria-current`); rename/delete only appear on hover → **keyboard and touch users can never rename or delete**. | `<Link>` + always-visible `ActionMenu`. |
| P1-U10 | `documents/page.tsx:202-289`; `DocumentsTab.tsx:137`; `chat/page.tsx:722`; `settings/page.tsx:19` | Document modal has no Escape/focus trap; delete uses native `confirm()`, feedback and rename use `window.prompt()`. Five different toast/confirm systems; `@radix-ui/react-toast` is installed and unused. | One `Modal`, one `ConfirmDialog`, one `Toast`; ban `window.confirm/prompt`. |
| P1-U11 | `chat/page.tsx:502-519` | Double-send race: the guard checks `activeConvId`, which is still `null` while `createConversation` is in flight → two quick Enters create two conversations and two streams. | `creatingRef` guard + disabled composer. |
| P1-U12 | `documents/page.tsx:56-95` | Two overlapping pollers (5 s + 1.5 s) call an uncancellable `loadDocuments` → a stale page response can overwrite the current page. | One poller, `AbortSignal`, request-id guard. |
| P1-U13 | `PersonalAnalytics.tsx:99-114`; `AppShell.tsx:135-142` | No stale-response guard on range/page switching; the header shows the new range over old data. | `requestId` ref pattern (already used in `QuestionsTab.tsx:61`). |
| P1-U14 | `features/admin/AnalyticsTab.tsx` (397 lines) | **Dead file** — never imported; a stale copy of `OrganizationAnalytics.tsx`. Also dead: `AdminMember/getMembers`, `documentsApi.get/getStatus`, `chatApi.ask`, `chatSchema`, `PlatformAdminUser` (backend, zero routes). | Delete. |
| P1-U15 | `admin/page.tsx:940-987` vs `features/admin/InsightUi.tsx:50-123` | `Section`, `EmptyRow`, `Skeleton`, `Pagination` are copy-pasted and have already drifted. Four pagination implementations, three label formats. | Import from `InsightUi`; one `<Pagination>`. |
| P1-U16 | `documents/page.tsx` vs `features/admin/DocumentsTab.tsx` | The same document list implemented twice against two endpoints, with different fields, status colour maps, polling and date formatting. | One `DocumentTable` with `variant="library" \| "admin"`. |
| P1-U17 | `chat/page.tsx:941-949` | "Upload documents" sends **everyone** to `/admin?tab=Documents`; members land on the Access Denied screen. | Route by role; hide for members or send to `/documents`. |
| P1-U18 | `settings/page.tsx:111-127` | "System online / Healthy" is hard-coded green and never checked. | Poll real `/health/ready` or delete the card. |

### Observability (currently: logs only, and they cannot answer "why 12 s?")

| # | Location | Issue |
|---|---|---|
| P1-O1 | `pyproject.toml` declares `prometheus-client`, `opentelemetry-*` — **zero usage**. No `/metrics` endpoint (though `middleware.py:66` already skips it), no traces, no error tracking. |
| P1-O2 | No per-stage timing in the RAG path: embedding, vector search, keyword search, rerank, prompt build, LLM, persistence are invisible. Measured 11.5 s request vs 981 ms LLM — unexplained. |
| P1-O3 | `middleware.py:52, 128` — `request_id` in the error body comes from the **request header**, not contextvars, so the ID in the response differs from the ID in the logs (`"unknown"` when the client sent none). |
| P1-O4 | `RequestLoggingMiddleware` logs method/path/status/duration/IP only — no `user_id`, `org_id`, route template, response bytes. No sampling, no slow-request threshold. |
| P1-O5 | `db/session.py:45` `echo=settings.debug` → `DEBUG=true` prints every SQL statement (visible in the dev log), a major latency and log-volume cost. |
| P1-O6 | `health.py:29-62` — readiness returns 503 when **Redis** is down even though the app is designed to degrade to inline ingestion; no check for embedding-model readiness, Celery worker heartbeat, queue depth, or disk space. `-> dict` annotation returns `JSONResponse` (breaks OpenAPI). |
| P1-O7 | No alerting, no SLOs, no dashboards, no synthetic checks. No CI (no `.github/workflows`). |
| P1-O8 | `logging.py` has no PII redaction processor and no exception `event` on unhandled rejections; Celery logs are not JSON (workers still use the default format). |

---

## 3. P2 — quality, consistency, cleanup

**Frontend**

* `/` always redirects to `/login`; `/login` never bounces an authenticated user (`app/page.tsx:8`).
* Hard-coded **1500 ms** login delay for a mascot wink (`login/page.tsx:224`).
* `useSearchParams()` with no `<Suspense>` in `AppShell`, `admin`, `analytics`, `QuestionsTab`.
* `MarkdownContent` is not memoised and re-parses/re-highlights on **every SSE token**;
  `react-syntax-highlighter` full Prism build is imported statically (418 kB first load).
* Thumbnail fetches `https://www.google.com/s2/favicons?...` per citation — third-party request,
  document-domain leak.
* Four independent pollers (10 s/15 s/5 s/1.5 s) with no visibility awareness.
* `AmbientMotion` runs 6 infinite animations + 3 blurred blobs under every page.
* Three date formats, three status-colour maps, four "primary button" styles, three active-tab
  treatments, three names for documents ("Documents"/"Knowledge base"/"Document library"),
  UK/US split ("Favourite" vs `favorite`). Model names formatted three ways.
* Collapsing the sidebar hides **all nav and Sign out** with no icon rail.
* `swr`, `js-cookie`, `class-variance-authority` and 9 Radix packages are installed but unused.
* `useHistoryNavigation` monkey-patches `window.history.pushState` to re-implement Back/Forward.
* `register/page.tsx` is a client page that only `router.replace`s; make it a server `redirect()`.
* Accessibility: `role="menu"` with no focus management, no `aria-haspopup`, no click-outside in
  the notification menu, no focus trap in the document modal.
* `[Source_4]` (underscore) appears in answers — the citation regex only matches `[Source 4]`.

**Backend**

* Dead config: `max_input_tokens`, `max_output_tokens`, `embedding_batch_size`,
  `summarize_after_messages`, `Organization.max_documents/max_storage_mb`,
  `ConversationSummary` (no summarisation is implemented at all — long chats silently lose
  everything beyond the last 6 messages).
* Dead enums never produced: `DocumentStatus.REINDEXING`, `JobStatus.RETRYING/FAILED`,
  `UserStatus.PENDING`.
* `checksum_sha256`, `DocumentChunk.content_hash`, `validate_dimensions()`, `generate_api_key()`
  are unused.
* `python-jose` is a declared dependency; the code uses **PyJWT**.
* `search` ILIKE terms are not escaped → `%`/`_` wildcard injection forces full scans.
* 404-vs-403 inconsistency for "not found in tenant" (`admin.py:224, 299`;
  `notifications.py:69` raise 403 where the rest of the app raises 404).
* Password policy enforced on register/reset but **not** on `AdminUserCreate` /
  `AdminPasswordReset` (`schemas/user_admin.py:38, 55`).
* Feedback has no uniqueness constraint and fans out one notification row **per org admin** per
  thumbs-down; the route is not rate-limited.
* `chat.py:294-304` cancel requires a full `ChatRequest` including `question` (must send a fake
  question or get 422).
* Non-Latin-1 filenames raise `UnicodeEncodeError` at send time in `Content-Disposition`
  (`documents.py:99-112`) → 500 on download.
* `get_messages` paginates by offset from the end with no `id` tiebreaker → unstable pages.
* `.rtf` is routed to the plain-text extractor → control words (`{\rtf1\ansi…}`) get indexed.
* `_ocr_image` constructs a **new RapidOCR engine per page** (`ingestion_service.py:196`);
  `fitz` handles leak on error (`:150`).

---

## 4. Verified-but-fine (do not "fix" these)

* Tenant scoping: every tenant query in routers and `insights_service` filters
  `organization_id`; `retrieval_service` puts it in the `WHERE`, not a post-filter.
* Storage: server-generated paths, `is_relative_to` traversal guard, CR/LF scrubbed from
  `Content-Disposition`.
* No SQL injection: no `text()` with interpolation; the only dynamic SQL is constant with bound
  params.
* No mass assignment: no request schema exposes `organization_id`, `is_platform_admin` or
  `status` (the one exception, `RegisterRequest.organization_id`, is allowlisted).
* Pagination is capped at 100 everywhere.
* Argon2id 64 MB / t=3; refresh tokens are opaque 64-byte urlsafe values stored hashed.
* `_get_model` double-checked locking is correct (no double load race).
* Single-flight refresh in `client.ts:104-125` is correct.
* Error responses never leak tracebacks (`middleware.py:149-160`).

---

## 5. Severity roll-up

| Area | P0 | P1 | P2 |
|---|---|---|---|
| Security / authz | 3 | 15 | 12 |
| Correctness / data | 3 | 20 | 24 |
| UI / UX / duplication | 1 | 18 | 22 |
| Observability | 0 | 8 | 6 |
| Deployment / DB ops | 2 | 4 | 3 |

**Release verdict: not production-ready.** The blockers are concentrated in four places:
retrieval authorization (P0-1), authorization source of truth (P0-2), ingestion robustness
(P0-7), and the fact that nothing observable would have caught them (P1-O1/O2).
