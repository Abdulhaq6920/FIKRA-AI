# Debugging Guide

## Backend debugging

### Reading structured logs

The backend emits JSON logs in production. In development with `LOG_FORMAT=console`, logs are human-readable.

Every request includes a `request_id` field. To follow a single request through all log lines:

```powershell
# Filter logs for a specific request ID (Linux/Mac)
docker compose logs backend | grep "request_id=abc-123"

# Windows PowerShell
docker compose logs backend | Select-String "abc-123"
```

### Enabling SQL query logging

Set `DEBUG=true` in `.env`. SQLAlchemy will log every SQL statement to stdout.

### Checking the configuration at startup

```powershell
cd backend
.venv\Scripts\python.exe -c "from app.core.config import settings; import json; print(json.dumps({k: '***' if 'key' in k or 'password' in k or 'secret' in k else v for k, v in settings.model_dump().items()}, indent=2, default=str))"
```

This prints all config values, redacting secrets.

### Inspecting a JWT token

```powershell
# Decode (not verify) a JWT for debugging
.venv\Scripts\python.exe -c "
import jwt, sys
token = sys.argv[1]
print(jwt.decode(token, options={'verify_signature': False}))
" YOUR_TOKEN_HERE
```

---

## Common error patterns

### `ModuleNotFoundError: No module named 'sentence_transformers'`

The embedding model requires `sentence-transformers`. Install it:

```powershell
cd backend
uv pip install sentence-transformers torch --index-url https://download.pytorch.org/whl/cpu
```

The app starts without it (lazy import). The error only appears when embeddings are actually called.

### `No module named 'pgvector'`

```powershell
uv pip install pgvector
```

### Database connection refused

```powershell
# Check PostgreSQL is running
docker compose ps postgres

# Check the DATABASE_URL in .env matches the container
# Default: postgresql+asyncpg://fikra:fikrapass@localhost:5432/FIKRA AI
```

### Alembic migration fails: "relation already exists"

The schema was partially created. Reset the development database:

```powershell
cd backend
.venv\Scripts\python.exe ..\scripts\reset_dev_db.py --confirm
alembic upgrade head
python ..\scripts\create_initial_org.py
```

### Celery worker not processing tasks

```powershell
# Check Redis is running
docker compose ps redis

# Check the Celery broker URL
# CELERY_BROKER_URL=redis://localhost:6379/2

# Check for tasks in the queue
.venv\Scripts\python.exe -c "
from app.workers.celery_app import celery_app
inspect = celery_app.control.inspect()
print('Active:', inspect.active())
print('Reserved:', inspect.reserved())
"
```

### Groq API errors

| Error code | Meaning | Fix |
|------------|---------|-----|
| `PROVIDER_RATE_LIMITED` | Hit Groq rate limit | Wait, reduce `RATE_LIMIT_CHAT`, or upgrade Groq plan |
| `PROVIDER_UNAVAILABLE` | Groq API down or network issue | Check https://status.groq.com |
| `AUTHENTICATION_FAILED` at startup | Invalid `GROQ_API_KEY` | Check the key in `.env` |

### 401 on all API requests after restart

The access token cookie has expired. The frontend should automatically call `/api/v1/auth/refresh` via the API client. If it doesn't, manually log in again.

---

## Debugging the RAG pipeline

To trace a full question through the pipeline, add a breakpoint in `rag_service.py:answer()`:

```python
# In app/services/rag_service.py, inside answer()
import pdb; pdb.set_trace()  # add temporarily
```

Then send a request via the API. The debugger will open in the uvicorn terminal.

Or use structured logging to trace retrieval scores:

```python
logger.debug(
    "retrieval_scores",
    passages=[{"title": p.document_title, "score": p.score} for p in passages]
)
```

Set `LOG_LEVEL=DEBUG` in `.env` to see debug logs.

---

## Debugging the frontend

### API request tracing

Open browser DevTools → Network tab. All API calls go to `/api/v1/*`.

Check:
- Request cookies include `access_token` (should be HttpOnly — visible in Application → Cookies but not in JS)
- Response status codes match what you expect
- Error responses include `error.code` and `error.message`

### Auth redirect loop

If you're being redirected to `/login` in a loop:
1. Check `/api/v1/auth/me` in DevTools — if it returns 401, the access token is missing/expired
2. Check `/api/v1/auth/refresh` is being called automatically
3. Clear cookies (`Application → Cookies → Clear all`) and log in fresh

### Streaming not working

If the chat page shows no streaming response:
1. Check the browser supports `ReadableStream` (modern browsers do)
2. Check the `text/event-stream` response in Network tab
3. Look for `[ERROR]` or `[DONE]` in the event stream

---

## Performance profiling

```powershell
# Profile the retrieval pipeline
cd backend
.venv\Scripts\python.exe -c "
import asyncio, cProfile
from app.services.retrieval_service import retrieve

async def profile():
    # requires a live DB connection
    pass

cProfile.run('asyncio.run(profile())', sort='cumulative')
"
```

For production profiling, use OpenTelemetry traces (configured in `core/middleware.py`).
