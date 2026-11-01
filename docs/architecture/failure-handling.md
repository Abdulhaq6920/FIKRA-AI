# Failure Handling

## Groq provider failures

| Error | HTTP status | Retry? | User sees |
|-------|------------|--------|-----------|
| Rate limit (429) | 503 | Yes (3x backoff) | "The AI provider rate limit was reached." |
| Timeout | 503 | Yes | "The AI provider is temporarily unavailable." |
| 5xx server error | 503 | Yes | Same as timeout |
| 4xx bad request | 503 | No | Generic provider error |
| Network error | 503 | Yes | Same as timeout |

Retry strategy: tenacity with `wait_exponential_jitter(initial=1, max=20)` and `stop_after_attempt(3)`.
Permanent errors (4xx bad request) are not retried.

The concurrency semaphore (`GROQ_MAX_CONCURRENT_REQUESTS`) prevents flooding the provider.

## Document ingestion failures

| Error | Job status | Document status | Retry |
|-------|-----------|-----------------|-------|
| Extraction error | RETRYING | PROCESSING | Yes (3x) |
| OCR timeout | RETRYING | PROCESSING | Yes |
| No text extracted | DEAD | FAILED | No (manual reindex) |
| Soft time limit | DEAD | FAILED | No |
| Max retries exceeded | DEAD | FAILED | Manual only |

Admins can trigger reindex via `POST /api/v1/documents/{id}/reindex`.

Errors stored in the database are sanitized: `error_type` (class name) and `error_message` (first 256 chars).
Raw stack traces are logged at ERROR level but never exposed to users.

## Database failures

- Connection pool with `pool_pre_ping=True` detects stale connections.
- `pool_recycle=1800` prevents long-lived connections from going stale.
- On transaction error, the session is rolled back (see `get_db()` dependency).
- The health check at `/api/v1/health/ready` reports DB status.

## Redis failures

If Redis is down:
- Celery tasks cannot be dispatched (document uploads will still save the file but not process)
- Caching is bypassed gracefully (not yet implemented)
- The API remains available for non-queued operations

## Frontend failure states

Every page implements:
- **Loading**: skeleton placeholder or spinner
- **Empty**: helpful message with a CTA ("No documents uploaded yet")
- **Error**: inline error with retry option
- **No access**: "Access Denied" page for unauthorized roles

The API client automatically retries on 401 by calling `/auth/refresh`. If refresh fails, the user is redirected to `/login?session_expired=1`.

## Graceful shutdown

- Uvicorn handles SIGTERM by finishing in-flight requests before exiting.
- Celery `task_acks_late=True` means tasks are re-queued if the worker dies.
- `task_reject_on_worker_lost=True` ensures tasks aren't lost on worker crash.
- Database connections are disposed in the FastAPI lifespan shutdown handler.
