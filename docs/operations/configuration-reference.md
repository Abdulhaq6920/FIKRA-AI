# Configuration Reference

All configuration is loaded from environment variables (or `.env` file in development). The application validates all settings at startup and fails fast on missing required values.

## Application

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `APP_NAME` | `FIKRA AI` | No | Display name |
| `APP_ENV` | `development` | No | `development`, `staging`, `production` |
| `DEBUG` | `false` | No | Enable debug mode and SQL logging |
| `SECRET_KEY` | auto-generated | **Yes (prod)** | General application secret |

## LLM provider

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `LLM_PROVIDER` | `groq` | No | `groq` or `ollama` |

## Groq

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `GROQ_API_KEY` | — | When `LLM_PROVIDER=groq` | Groq API key from console.groq.com |
| `GROQ_PRIMARY_MODEL` | `llama3-8b-8192` | No | Primary generation model |
| `GROQ_FALLBACK_MODEL` | `gemma2-9b-it` | No | Fallback model (set empty to disable) |
| `GROQ_MAX_TOKENS` | `2048` | No | Max output tokens per request |
| `GROQ_TEMPERATURE` | `0.2` | No | Sampling temperature (0.0–2.0) |
| `GROQ_TIMEOUT_SECONDS` | `60` | No | Request timeout |
| `GROQ_MAX_CONCURRENT_REQUESTS` | `10` | No | Semaphore limit for concurrent Groq calls |

## Ollama

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | No | Ollama server URL; use `http://host.docker.internal:11434` when the backend runs in Docker Desktop |
| `OLLAMA_MODEL` | `deepseek-r1:8b` | No | Local Ollama model tag |
| `OLLAMA_MAX_TOKENS` | `2048` | No | Maximum output tokens |
| `OLLAMA_TEMPERATURE` | `0.2` | No | Sampling temperature (0.0–2.0) |
| `OLLAMA_TIMEOUT_SECONDS` | `300` | No | Request timeout, in seconds |
| `OLLAMA_MAX_CONCURRENT_REQUESTS` | `2` | No | Maximum concurrent Ollama requests |

## Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:root@localhost:5432/rag-prod AI` | **Yes** | Async PostgreSQL connection string |
| `DATABASE_POOL_SIZE` | `20` | No | Connection pool size |
| `DATABASE_MAX_OVERFLOW` | `40` | No | Max additional connections |
| `DATABASE_POOL_TIMEOUT` | `30` | No | Connection acquisition timeout (seconds) |

## Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection for caching |
| `REDIS_CACHE_DB` | `1` | Redis DB index for application cache |

## JWT / Authentication

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `JWT_SECRET_KEY` | auto-generated | **Yes (prod)** | HMAC signing key — use `openssl rand -hex 64` |
| `JWT_ALGORITHM` | `HS256` | No | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | No | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | No | Refresh token lifetime |

## Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | HuggingFace model ID |
| `EMBEDDING_DIMENSIONS` | `384` | Must match the model's output dimensions |
| `EMBEDDING_BATCH_SIZE` | `32` | Chunks per embedding batch |
| `RERANKER_MODEL` | `BAAI/bge-reranker-base` | Cross-encoder model |
| `RERANKER_ENABLED` | `true` | Enable/disable reranking |

**Warning**: If you change `EMBEDDING_MODEL`, you must also change `EMBEDDING_DIMENSIONS` and reindex all documents. Mixing vectors from different models produces incorrect retrieval results.

## Retrieval

| Variable | Default | Description |
|----------|---------|-------------|
| `RETRIEVAL_TOP_K` | `20` | Candidates retrieved before reranking |
| `RERANKER_TOP_N` | `5` | Passages kept after reranking |
| `MIN_RELEVANCE_SCORE` | `0.3` | Minimum score threshold |

## Documents

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_UPLOAD_SIZE_MB` | `50` | Maximum file size in MB |
| `ALLOWED_EXTENSIONS` | `pdf,docx,md,html,txt` | Comma-separated allowed extensions |
| `UPLOAD_DIR` | `./uploads` | Base directory for local storage |

## Workers

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CONCURRENCY` | `4` | Celery worker processes |
| `CELERY_BROKER_URL` | `redis://localhost:6379/2` | Celery task queue |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/3` | Celery result storage |

## Token budgets

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_INPUT_TOKENS` | `6000` | Maximum tokens sent to Groq per request |
| `MAX_OUTPUT_TOKENS` | `2048` | Maximum tokens in Groq response |
| `MAX_CONTEXT_MESSAGES` | `20` | Recent messages included in context |
| `SUMMARIZE_AFTER_MESSAGES` | `30` | Trigger conversation summarization |

## Rate limits

| Variable | Default | Format |
|----------|---------|--------|
| `RATE_LIMIT_LOGIN` | `10/minute` | `N/period` |
| `RATE_LIMIT_CHAT` | `30/minute` | `N/period` |
| `RATE_LIMIT_UPLOAD` | `5/minute` | `N/period` |

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `LOG_FORMAT` | `json` | `json` (production) or `console` (development) |

## CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated allowed frontend origins |

---

## Generating secure secrets

```powershell
# JWT secret (PowerShell)
python -c "import secrets; print(secrets.token_hex(64))"

# Or use OpenSSL
openssl rand -hex 64
```

Never use the example values from `.env.example` in production.
