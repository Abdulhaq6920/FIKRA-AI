# FIKRA AI

**Production-grade, multi-tenant RAG chatbot**

Organizations upload documents → users ask questions → grounded answers with validated citations powered by Groq or a local Ollama model.

---

## Quick start

### 1. Prerequisites

- Docker Desktop 4.x+
- Python 3.11+
- Node.js 20 LTS

### 2. Configure environment

```powershell
Copy-Item backend\.env.example backend\.env
# Edit backend\.env — set LLM_PROVIDER, SECRET_KEY, and JWT_SECRET_KEY
```

For Groq, set `LLM_PROVIDER=groq` and add a Groq API key. To use your local
Ollama model, set:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:8b
```

Keep Ollama running while you use the app. If the backend runs inside Docker
Desktop, set `OLLAMA_BASE_URL=http://host.docker.internal:11434` instead.

Generate secure secrets:
```powershell
python -c "import secrets; print(secrets.token_hex(64))"
```

### 3. Start infrastructure

```powershell
docker compose up -d postgres redis
```

### 4. Backend setup

```powershell
uv python install 3.12
uv venv --python 3.12 .venv
cd backend
uv pip install --python ..\.venv\Scripts\python.exe -e ".[dev]"
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe ..\scripts\create_initial_org.py
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 5. Worker

```powershell
# New terminal, from the repository root
cd backend
..\.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion
```

### 6. Frontend

```powershell
cd frontend
npm.cmd install --legacy-peer-deps
npm.cmd run dev
```

Open **http://localhost:3000**

Login: `admin@fikra.ai` / `Admin1234!` (change immediately)

---

## Architecture

```
Browser → Next.js → FastAPI → PostgreSQL+pgvector
                            → Redis (Celery queue)
                            → Groq API or local Ollama (LLM)
                  Celery Worker → Storage → Embeddings → PostgreSQL
```

- **Multi-tenant**: Every resource is scoped to an organization. Cross-tenant access is impossible through the API.
- **RAG pipeline**: Hybrid retrieval (pgvector cosine + PostgreSQL FTS) → RRF fusion → optional cross-encoder reranking → bounded prompt → Groq generation → server-validated citations.
- **Secure auth**: Argon2id passwords, JWT in HttpOnly cookies, refresh token rotation.

Full documentation: [`docs/`](docs/)

---

## Running tests

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest tests/unit/ tests/tenant_isolation/ -v
```

## API documentation

Available at http://localhost:8000/api/docs (development only)

---

## Directory structure

```
backend/   FastAPI + SQLAlchemy + Celery
frontend/  Next.js 14 + Tailwind + Framer Motion
docs/      Architecture, ADRs, setup guides
scripts/   Bootstrap and maintenance scripts
docker/    Docker support files
```

See [`docs/development/project-structure.md`](docs/development/project-structure.md) for the full layout.

---

## Key configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_PROVIDER` | No | `groq` (default) or `ollama` |
| `GROQ_API_KEY` | Groq only | Groq hosted inference key |
| `OLLAMA_BASE_URL` | Ollama only | Ollama server URL, usually `http://localhost:11434` |
| `OLLAMA_MODEL` | Ollama only | Local Ollama model tag, e.g. `deepseek-r1:8b` |
| `DATABASE_URL` | ✅ | PostgreSQL async connection string |
| `JWT_SECRET_KEY` | ✅ | JWT signing secret (64-byte hex) |
| `SECRET_KEY` | ✅ | App secret (64-byte hex) |
| `REDIS_URL` | No | Redis connection (default: localhost:6379) |

Full reference: [`docs/operations/configuration-reference.md`](docs/operations/configuration-reference.md)

---

## Known limitations

1. **Email delivery not implemented** — password reset tokens are logged in debug mode only. Configure SMTP settings to enable real email.
2. **Document-level ACLs not fully implemented** — all org members see all org documents. `access_level=restricted` is a placeholder.
3. **PostgreSQL RLS not yet enabled** — recommended as defense-in-depth (see tenant isolation docs).
4. **Load testing not yet run** — performance claims require measurement against your hardware and Groq quota.
5. **Rate limiting at route level not yet wired** — the configuration exists; the enforcement middleware (slowapi) needs to be integrated in Phase 9.
6. **Groq quota** — free tier is ~14,400 requests/day. Production requires a paid Groq plan.

---

## License

MIT
