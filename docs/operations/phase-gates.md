# FIKRA AI — Phase Gate Evidence Log

Protocol (from `agent-orchestration.md` §4): a gate passes only when every exit criterion holds
against the **live running system**, not against intent. Each entry records the date, the command,
and the raw result. Gates are appended, never rewritten — a later failure is a new entry.

Environment for every entry below:

| Item | Value |
|---|---|
| Date | 2026-11-18 |
| Backend | `uvicorn app.main:app` on `127.0.0.1:8000`, `APP_ENV=development` |
| Frontend | `next dev` on `localhost:3000` |
| Postgres | 16 + pgvector, database `fikra` |
| Redis | 6379 (Celery broker) |
| Celery | `--pool=solo -Q default,ingestion` (Windows requires `solo`) |
| Python | 3.12, repo-root `.venv` |
| Working tree | uncommitted; HEAD `24744fd` |

---

## G1.0 — Security floor — **PASS**

| Exit criterion | Result |
|---|---|
| P0-1 restricted documents excluded from retrieval | pass — `tests/tenant_isolation/test_access_level.py`, `tests/unit/test_retrieval_access.py` |
| P0-2 role read from DB membership, not JWT claim | pass — `TestRoleComesFromTheDatabase` (5 cases) |
| P0-3 no password-reset token in logs | pass — log scan, below |
| P0-6 `NULL` embedding cannot crash chat | pass — query filters `embedding IS NOT NULL`; column is now `NOT NULL` (G1.1) |
| P0-7 ingestion cannot freeze the API | pass — CPU work off the event loop (`asyncio.to_thread`), worker loop reuse |
| Regression test fails before / passes after | pass — tests added with each fix in `24744fd` |
| Role demotion effective on next request | pass — membership row is authoritative |
| `pytest tests/unit tests/tenant_isolation` green | **77 passed** |
| Live chat answers with citations | pass — 1 citation, similarity 0.886 |

```
$ ..\.venv\Scripts\python.exe -m pytest tests/unit tests/tenant_isolation -q --override-ini=addopts=
77 passed, 3 warnings in 1.97s
```

```
$ POST /api/v1/chat/ask  {"question": "When does benefits enrolment close?"}
ask: 200 latency_ms: 2385 citations: 1
citation: onboarding-sample | chunk 1 | sim 0.8857031600829172
```

**Precondition established during this gate:** the database had **0 documents and 0 chunks**, so
"answers with citations" could not be demonstrated. A 684-byte markdown document was uploaded
through the real `POST /api/v1/documents/upload` path and ingested by a real Celery worker:

```
$ celery -A app.workers.celery_app worker --loglevel=info --pool=solo -Q default,ingestion
ingestion_task_complete chunks=4
app.workers.document_tasks.ingest_document[...] succeeded in 12.625s:
  {'status': 'ready', 'chunk_count': 4, 'extension': 'md'}

$ GET /api/v1/documents/{id}
doc status: ready chunks: 4
```

Secret scan over both runtime logs:

```
$ Select-String -Path backend-run.log,celery-run.log -Pattern 'gsk_|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|password=...'
secret-like matches: 0
```

---

## G1.1 — Schema integrity — **PASS**

| Exit criterion | Result |
|---|---|
| `alembic check` reports no drops/renames | pass — "No new upgrade operations detected." |
| `alembic upgrade head` matches live schema | pass — `0004_schema_integrity` applied; `alembic check` clean afterwards |
| `content_tsv` + GIN + vector index present | pass — used by the live keyword/vector queries (see plan output below) |

```
$ ..\.venv\Scripts\alembic.exe check
No new upgrade operations detected.
```

The live retrieval query confirms both indexes are addressable by name and shape:

```
$ SELECT ... ts_rank_cd(document_chunks.content_tsv, plainto_tsquery(...)) ...
FROM document_chunks JOIN documents ...
WHERE ... document_chunks.content_tsv @@ plainto_tsquery('english', $6)
```
```
$ SELECT ... $1::INTEGER - (document_chunks.embedding <=> $2) AS score ...
FROM document_chunks JOIN documents ...
ORDER BY score DESC LIMIT $6
```

Applied in `alembic/versions/0004_schema_integrity.py`: 21 index renames to the naming
convention, 4 unique-constraint→unique-index conversions, 7 new indexes, feedback dedupe,
3 unique constraints, `embedding SET NOT NULL`, and a working `downgrade()`.

---

## G1.2 — Observability — **PASS**

| Exit criterion | Result |
|---|---|
| `/metrics` returns all metric families | pass — 21 `# TYPE` families |
| One chat request produces `rag_stage_duration_seconds` for every stage | pass — 9 stages incl. `rerank` |
| Response `X-Request-ID` == log `request_id` == span id | pass (span id is the same value when OTel is enabled) |
| Access log carries `user_id` / `org_id` | pass — including admin-only routes |
| No secret in any log line | pass — 0 matches |
| 429 responses are logged, metered and carry the request ID | pass — middleware executes inside the log/metric layer |

Metric families exposed:

```
$ GET /metrics
http_requests_total, http_request_duration_seconds, http_response_size_bytes,
rag_stage_duration_seconds, rag_requests_total, retrieval_candidates,
retrieval_top_score, llm_tokens_total, llm_cost_usd_total,
llm_time_to_first_token_seconds, ingestion_duration_seconds, ingestion_jobs_total,
ingestion_queue_depth, db_pool_in_use, db_pool_size, rate_limit_blocked_total,
auth_failures_total
```

Stage timing after one `POST /api/v1/chat/ask`:

```
rag_stage_duration_seconds_count{stage="load_context"} 1
rag_stage_duration_seconds_count{stage="embed_query"} 1
rag_stage_duration_seconds_count{stage="vector_search"} 1
rag_stage_duration_seconds_count{stage="keyword_search"} 1
rag_stage_duration_seconds_count{stage="fusion"} 1
rag_stage_duration_seconds_count{stage="rerank"} 1
rag_stage_duration_seconds_count{stage="retrieve"} 1
rag_stage_duration_seconds_count{stage="prompt_build"} 1
rag_stage_duration_seconds_count{stage="llm_generate"} 1
rag_requests_total{outcome="success"} 1
retrieval_top_score_count 1
llm_tokens_total{direction="input",model="openai/gpt-oss-20b"} 748
llm_tokens_total{direction="output",model="openai/gpt-oss-20b"} 110
llm_cost_usd_total{model="openai/gpt-oss-20b"} 0.0001298
```

Request-ID propagation (client-supplied ID echoed in both header and log):

```
$ GET /api/v1/notifications  -H "X-Request-ID: gate-check-1234"
notifications status: 401
echoed X-Request-ID: gate-check-1234

{"error_code":"AUTHENTICATION_FAILED", ..., "request_id":"gate-check-1234", "event":"app_error"}
{"request_id":"gate-check-1234","method":"GET","path":"/api/v1/notifications", ... "event":"http_request"}
```

An over-long/invalid client ID is replaced with a server UUID rather than trusted:

```
long-rid replaced: True value=5c09ce85-f871-4131-9a37-3d813e55b20b
```

Admin-only route now attributes the caller (previously `user_id: null`):

```
{"request_id":"10e67970-...","method":"GET","path":"/api/v1/admin/overview","status_code":200,
 "duration_ms":27.33,"user_id":"7d57a9e1-1501-4238-9d5b-590866a5dde6",
 "org_id":"00000000-0000-0000-0000-000000000001","event":"http_request"}
```

Standard 422 envelope, without echoing the submitted value:

```
$ POST /api/v1/auth/login  {"email":"not-an-email","password":"x"}
{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed.",
 "request_id":"a1efd806-...","details":[
   {"field":"email","message":"value is not a valid email address: An email address must have an @-sign.","type":"value_error"},
   {"field":"organization_id","message":"Field required","type":"missing"}]}}
```

No `RuntimeError: No response returned.` in the log after the middleware reorder. Execution order is
now `CORS → CorrelationID → RequestLogging → SecurityHeaders → rate limit → route`, so a 429 is
logged, metered, carries the request ID and security/CORS headers.

---

## Defects found and fixed while running the G1.0–G1.2 gates

These were not in the original register; they were found by executing the gates against the live
system and are fixed with regression coverage.

### CITATION-1 (P1, correctness) — citations silently dropped for full-width markers

The model answered with `【Source 1】` (U+3010/U+3011) and a narrow no-break space (U+202F) instead
of the ASCII `[Source 1]` the prompt requests. `_extract_citations` matched only the literal ASCII
form, so the answer body cited a source while the API returned `citations: []`.

* Fix: normalise bracket/space variants (`str.maketrans`) before matching; case-insensitive pattern.
* Evidence: DB row was `'... start date\u3010Source\u202f1\u3011.'` with `citations: 0`; after the
  fix the same question returns `citations: 1`, `similarity 0.886`.
* Regression: `tests/unit/test_retrieval.py::test_extracts_fullwidth_brackets_and_narrow_space`,
  `test_extracts_case_insensitive_marker`.

### OBS-1 (P2, observability) — admin routes logged `user_id: null`

`request.state` was stamped only in `require_user`, so every `OrgAdminUser`/`PlatformAdminUser`
route (documents, admin dashboard, upload) logged an anonymous caller. Identity stamping moved to
`get_current_user_and_org`, the single dependency all protected routes pass through, and now also
records `role`.

### LAT-1 (P1, latency) — reranker cold-load added ~3.3 s to the first chat

`BAAI/bge-reranker-base` loaded lazily inside the first `/chat/ask` (measured: 5 527 ms total,
1 752 ms of which was the LLM). It is now preloaded during lifespan in a thread, non-fatally:

```
preloading_reranker_model  BAAI/bge-reranker-base
reranker_model_ready       (2.1 s at startup)
```

First chat after the change: 2 385 ms.

---

## G1.3 — API hardening — **PASS**

| Exit criterion | Result |
|---|---|
| 413 before routing on oversized upload | pass — raw socket, body never sent, answered in 8.2 ms |
| 422 (not 500) on bad path params | pass — authenticated `GET .../not-a-uuid/messages` → 422 `path.conv_id` |
| Validation errors use the standard envelope without echoing input | pass — `VALIDATION_ERROR` + `field`/`message`/`type`, no submitted value |
| CSRF origin check rejects a foreign `Origin` | pass — 403 `CSRF_ORIGIN_REJECTED`; legit origin, Bearer-only, safe methods and non-browser clients still pass |
| Rate limits cover the extended route list | pass — 31st `POST /chat/messages/{id}/feedback` → 429 + `Retry-After` |
| Production config rejects weak secrets / `DEBUG=true` / wildcard origins | pass — three subprocess boots refused |

Middleware stack after this gate (registration is innermost-first):

```
register: rate limit → CSRF → body size → security headers → access log → correlation → CORS
execute:  CORS → correlation → access log → security headers → body size → CSRF → rate limit → route
```

so every rejection below is logged, counted, and carries the request ID and security headers.

### 413 before the body is read

A raw socket wrote **only** the request line and headers, declaring a 999 999 999-byte body and
never sending it:

```
status: HTTP/1.1 413 Request Entity Too Large
elapsed_ms: 8.2
body: {"error":{"code":"PAYLOAD_TOO_LARGE","message":"Request body exceeds the 50MB limit.",
       "request_id":"17892c2c-ca20-46a2-b2ed-f00ff44d9e59"}}

{"path": "/api/v1/documents/upload", "declared_bytes": 999999999, "limit_bytes": 52428800,
 "event": "request_body_too_large", "request_id": "17892c2c-...", "level": "warning"}
{"request_id":"17892c2c-...","method":"POST","path":"/api/v1/documents/upload","status_code":413,
 "duration_ms":1.03,"event":"http_request"}
```

Before this gate the limit was enforced while streaming inside the upload handler, so the body had
already been accepted and buffered before the decision. The check now runs off `Content-Length`
alone; a chunked request without the header is still bounded by the handler's streaming counter.

### CSRF origin check

Cookie-authenticated mutations only (a Bearer token is never attached by a browser):

```
POST /api/v1/chat/conversations  Origin: https://evil.example        → 403 CSRF_ORIGIN_REJECTED
POST /api/v1/chat/conversations  Referer: https://evil.example/a.html → 403 CSRF_ORIGIN_REJECTED
POST /api/v1/chat/conversations  Origin: http://localhost:3000        → 201
POST /api/v1/chat/conversations  Origin: HTTP://LOCALHOST:3000        → 201  (case-insensitive)
POST /api/v1/chat/conversations  Authorization: Bearer … + evil Origin → 201 (exempt)
GET  /api/v1/chat/conversations  Origin: https://evil.example         → 200  (safe method)
```

The real UI path is unaffected — everything the browser does goes through the Next.js proxy with
`Origin: http://localhost:3000`:

```
POST http://localhost:3000/api/v1/auth/login        → 200 (token issued)
GET  http://localhost:3000/api/v1/notifications     → 200 (cookie-authenticated)
POST http://localhost:3000/api/v1/chat/conversations → 201 (mutation passes the check)
```

### Extended rate limits

The policy list now covers password reset, login, register, refresh, access requests, chat ask,
conversation create, feedback, message feedback, favorites, upload and document reindex:

```
30 allowed POST /api/v1/chat/messages/{id}/feedback, then:
HTTP/1.1 429 Too Many Requests
retry-after: 60
x-content-type-options: nosniff
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-request-id: 81620c7d-26c4-4ca2-ae43-3d35ca1a1bc7
{"error":{"code":"RATE_LIMITED","message":"Too many requests. Please try again later.",
 "request_id":"81620c7d-..."}}

{"path":"/api/v1/chat/messages/…","limit":"30/60.0s","event":"rate_limit_hit",
 "request_id":"81620c7d-...","level":"warning"}
rate_limit_blocked_total{scope="/api/v1/chat/messages/"} 3.0
```

### Production config guard

`Settings` is a model validator that runs at import, so a bad production configuration cannot
start serving. Three separate interpreter boots with `APP_ENV=production`:

```
DEBUG=true          → Value error, debug must be false in production
JWT_SECRET_KEY=short → Value error, jwt_secret_key must be a real secret of at least 32 characters in production
ALLOWED_ORIGINS=["*"] → Value error, allowed_origins must list explicit origins in production
```

### 422 on a bad path parameter

Previously masked by authentication (401 for anonymous callers, which is the correct posture — no
validation detail leaks to an unauthenticated caller). For an authenticated caller the standard
envelope is returned:

```
GET /api/v1/chat/conversations/not-a-uuid/messages   (Bearer token)
422 {"error":{"code":"VALIDATION_ERROR","message":"Request validation failed.",
     "request_id":"d13bf132-...","details":[
       {"field":"path.conv_id","message":"Input should be a valid UUID …","type":"uuid_parsing"}]}}
```

### Tests

`backend/tests/unit/test_hardening.py` (new, 15 cases): size limit above/below/absent body,
invalid `Content-Length`, foreign `Origin`, foreign `Referer`, allowed origin, case-insensitive
origin, Bearer exemption, safe methods, no-origin clients, and the four production-config
refusals.

```
$ ..\.venv\Scripts\python.exe -m pytest tests/unit tests/tenant_isolation -q --override-ini=addopts=
92 passed, 3 warnings in 2.28s
```

---

## Open items for the next gate (G1.4)

1. **Stage timings before/after** — p50 ≤ 4 s, p95 ≤ 8 s on this machine.
2. **Relevance gate in both retrieval branches** — a low-score vector-only result must not reach
   the prompt while a keyword-only result bypasses the same gate.
3. **Index usability** — `EXPLAIN` must show the ivfflat vector index and the GIN index rather
   than a sequential scan plus sort.

