# Troubleshooting

## Startup failures

### "GROQ_API_KEY is not configured"

```
RuntimeError: GROQ_API_KEY is not configured.
```

**Fix**: Add `GROQ_API_KEY=gsk_...` to `backend/.env`.

### "jwt_secret_key must be set to a real secret in production"

You are running `APP_ENV=production` with a placeholder JWT key.

**Fix**: Generate a real secret:
```powershell
python -c "import secrets; print(secrets.token_hex(64))"
```

Add to `.env`: `JWT_SECRET_KEY=<generated_value>`

### Database connection fails at startup

```
sqlalchemy.exc.OperationalError: connection to server ... failed
```

**Fix**:
1. Confirm PostgreSQL container is running: `docker compose ps postgres`
2. Check `DATABASE_URL` in `.env` matches the container port/credentials
3. Check the database exists: `docker compose exec postgres psql -U fikra -d FIKRA AI -c "\dt"`

### "relation does not exist"

Alembic migrations haven't been run.

**Fix**: `alembic upgrade head`

---

## Document ingestion issues

### Document stuck in QUEUED status

The Celery worker is not running.

**Fix**: Start the worker in a separate terminal:
```powershell
cd backend && .venv\Scripts\activate
celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion
```

### Document status = FAILED

Check the processing job details:
```
GET /api/v1/documents/{id}/status
```

The `error_type` and `error_message` fields explain what failed.

Common causes:
- **ExtractionError**: Corrupt or password-protected PDF
- **TimeoutError**: Document too large (increase `task_soft_time_limit` in `celery_app.py`)
- **ValueError: no text chunks**: The document is scanned/image-only; install Tesseract OCR

**Fix**: Retry ingestion via `POST /api/v1/documents/{id}/reindex`

### OCR not working for scanned PDFs

Tesseract is not installed.

**Fix** (Ubuntu/Debian):
```bash
apt-get install tesseract-ocr
```

**Fix** (Windows):
Download from https://github.com/UB-Mannheim/tesseract/wiki

### Embedding model download fails

```
OSError: Can't load tokenizer for 'BAAI/bge-small-en-v1.5'
```

No internet access or HuggingFace is blocked.

**Fix**:
```powershell
# Pre-download the model
.venv\Scripts\python.exe -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-en-v1.5')"
# Then set offline mode
# HF_HUB_OFFLINE=1 in .env
```

---

## Chat / RAG issues

### "No relevant document excerpts were found"

Possible causes:
1. No documents have been uploaded and indexed (status = READY)
2. The question uses very different vocabulary from the document content
3. `MIN_RELEVANCE_SCORE` threshold is too high

**Check**: `GET /api/v1/documents/` — are there documents with `status: "ready"`?

**Diagnose**: Temporarily lower `MIN_RELEVANCE_SCORE=0.1` in `.env`.

### Citations show wrong document

The RRF fusion or reranker is surfacing incorrect passages. Possible causes:
- Only one document indexed; the system shows what it has
- `RETRIEVAL_TOP_K` is too low; increase to 30
- Document chunks are too large; reduce `MAX_CHUNK_TOKENS` from 400 to 200 and reindex

### Groq returning truncated answers

The output hit `GROQ_MAX_TOKENS` limit. Increase it in `.env`:
```env
GROQ_MAX_TOKENS=4096
```

### 503 Provider Unavailable

Groq API is temporarily unreachable. Check:
- https://status.groq.com
- Your network/firewall allows outbound HTTPS to `api.groq.com`
- `GROQ_TIMEOUT_SECONDS` is not too short (default 60)

---

## Authentication issues

### Login returns 401 even with correct credentials

1. Check the `organization_id` in the login request matches the organization the user belongs to
2. Check the user's `status` is `active` (not `pending`, `disabled`)
3. Check the user's membership `is_active=true`

**Diagnose** (admin only):
```sql
SELECT u.email, u.status, m.role, m.is_active
FROM users u
JOIN organization_memberships m ON m.user_id = u.id
WHERE u.email = 'user@example.com';
```

### "Token is missing the iat claim"

Old tokens issued before the `iat` fix. Users need to log in again.

### Cookies not being sent

In development (`APP_ENV=development`), cookies are set with `Secure=false`.  
If your browser blocks non-HTTPS cookies, either:
- Access the app via `http://localhost:3000` (not `https`)
- Or set up a local TLS certificate

---

## Performance issues

### Slow vector search

Run `VACUUM ANALYZE document_chunks;` in PostgreSQL after large bulk ingestion.  
The IVFFlat index needs updated statistics.

If you have >1M chunks, increase the IVFFlat `lists` parameter from 100 to `sqrt(rows)`.

### High memory usage in worker

The embedding model (~90MB) and reranker (~300MB) are loaded once per worker process.  
With `WORKER_CONCURRENCY=4` you need ~1.6GB RAM for model weights alone.

Reduce concurrency: `WORKER_CONCURRENCY=2`  
Or disable the reranker: `RERANKER_ENABLED=false`

### Celery queue growing unbounded

More documents are being uploaded than the worker can process.

**Fix**: Increase `WORKER_CONCURRENCY` or add more worker instances.  
**Monitor**: http://localhost:5555 (Flower dashboard) — start with `celery -A app.workers.celery_app flower`
