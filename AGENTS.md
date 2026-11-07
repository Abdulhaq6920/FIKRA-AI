# AGENTS.md — FIKRA AI

Agent-only guidance. Do not import, reference, or ship this file from app/build code.

## Stack

- **Backend:** Python 3.12, FastAPI 0.111, SQLAlchemy 2 async + asyncpg, Alembic,
  PostgreSQL 16 + pgvector, Redis + Celery, Groq LLM, sentence-transformers
  (BGE embeddings + reranker), structlog.
- **Frontend:** Next.js 14 App Router, React 18, TypeScript 5.5, Tailwind,
  Radix UI, Framer Motion, SWR, Zod. Package manager: npm (use `npm.cmd` on Windows).
- **Monorepo:** backend and frontend are independent packages; one shared Python
  venv lives at the repo root (`.venv/`), not in `backend/`.

## Layout

```
backend/app/main.py              FastAPI app factory, middleware, lifespan
backend/app/core/                config, security, exceptions, logging, middleware
backend/app/api/v1/              route modules (auth, chat, documents, admin, ...)
backend/app/api/dependencies.py  auth/role dependencies + tenant context
backend/app/services/            auth, ingestion, retrieval, RAG pipeline
backend/app/providers/           Groq client (only Groq import), embeddings, reranker
backend/app/db/models/           SQLAlchemy models; every tenant resource has organization_id
backend/app/db/session.py        async engine, get_db() (commit/rollback/close)
backend/app/workers/             Celery app + document ingestion task
backend/alembic/versions/        migrations (excluded from lint/type-check)
backend/tests/{unit,integration,tenant_isolation}/
frontend/src/app/                routes; (public) and (protected) route groups
frontend/src/lib/api/            typed fetch wrapper + API modules
frontend/src/features/           feature-level React context/modules
frontend/src/types/index.ts      TS mirrors of backend schemas
docs/                            architecture, ADRs, dev/ops guides
```

## Commands (PowerShell, from repo root)

### Setup (first time)

```powershell
Copy-Item backend\.env.example backend\.env   # then fill GROQ_API_KEY, SECRET_KEY, JWT_SECRET_KEY
docker compose up -d postgres redis
uv python install 3.12
uv venv --python 3.12 .venv
cd backend
uv pip install --python ..\.venv\Scripts\python.exe -e ".[dev]"
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe ..\scripts\create_initial_org.py
```

Frontend:

```powershell
cd frontend
npm.cmd install --legacy-peer-deps
```

### Dev

```powershell
# Backend (from backend/; .env is read relative to CWD)
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# Celery worker (from backend/)
..\.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion

# Frontend (from frontend/)
npm.cmd run dev          # http://localhost:3000, proxies /api/* to :8000 via BACKEND_URL
```

### Test

```powershell
# Fast, no DB (from backend/)
..\.venv\Scripts\python.exe -m pytest tests/unit tests/tenant_isolation -q --override-ini=addopts=

# Integration (requires PostgreSQL; set TEST_DATABASE_URL)
..\.venv\Scripts\python.exe -m pytest tests/integration -q --override-ini=addopts=

# All backend tests with coverage
..\.venv\Scripts\python.exe -m pytest -q

# Frontend type-check
cd frontend; npm.cmd run type-check
```

### Lint / format / type-check

```powershell
cd backend
..\.venv\Scripts\ruff.exe check app/
..\.venv\Scripts\ruff.exe format app/
..\.venv\Scripts\mypy.exe app/
```

### Build

```powershell
cd frontend; npm.cmd run build
# Backend image: docker compose build backend worker
```

## Conventions

- Backend style: `from __future__ import annotations`, module docstrings, line
  length 100, double quotes, full type annotations (Ruff `ANN`, mypy strict).
- Routes: `APIRouter(prefix=..., tags=[...], response_model=...)`; register in
  `app/api/router.py`. Protected routes use `CurrentUser` / `OrgAdminUser` /
  `PlatformAdminUser` from `app/api/dependencies.py`.
- Multi-tenancy invariant: every query on tenants' data MUST filter by
  `organization_id`; org ID comes from the signed JWT, never from user input.
- Errors: raise typed `AppError` subclasses from `app/core/exceptions.py`
  (they carry HTTP status + code); do not leak raw exception text.
- DB sessions: use `Depends(get_db)`; it commits on success and rolls back on
  error. Use the service layer for non-trivial business logic.
- LLM access: only through `app/providers/groq_client.py`. Embeddings only via
  `app/providers/embeddings.py`; reranking via `app/providers/reranker.py`.
- Frontend: all HTTP through `src/lib/api/client.ts` (`api.get/post/upload/stream`);
  cookies are HttpOnly, credentials always included. Types live in
  `src/types/index.ts`, Zod schemas in `src/lib/validation/schemas.ts`.
- Use the `@/` import alias for `frontend/src/`.
- Tests: unit tests mock the Groq client (never live calls); tenant-isolation
  tests carry a docstring proving what cross-tenant access is blocked.

## Gotchas

- **Windows:** invoke `npm.cmd` (not `npm`); use `..\.venv\Scripts\python.exe`.
- Run backend commands from `backend/` — Pydantic Settings loads `.env` from CWD.
- `alembic.ini` uses `%(DATABASE_URL)s`, so the env var must be set (backend/.env).
- First backend start downloads/loads the ~130 MB embedding model; set
  `HF_HUB_OFFLINE=1` after the first download to skip network checks.
- `python-magic` needs the libmagic system library; the Docker image installs it.
  Code already falls back if `import magic` fails.
- `pgvector/pgvector:pg16` is required, not plain `postgres:16`.
- Integration tests: `tests/conftest.py` defaults to SQLite, but the models use
  PostgreSQL `UUID`/`JSONB`/`Vector` defaults — SQLite cannot create the schema.
  Set `TEST_DATABASE_URL` to a real PostgreSQL URL (Docker is not available on
  this machine currently). `aiosqlite` is installed but only moves the failure.
- Ruff currently reports ~200 pre-existing violations across `app/` and mypy is
  strict. Do not mass-fix unrelated files; check only the files you touched.
- Docker Compose mounts `./backend` into the container for hot reload; uploads
  are a named volume. Never run `docker compose down -v` (deletes data).
- Frontend `npm run lint` currently prompts to create ESLint config (no config
  committed); use `npm run type-check` as the reliable check.
- Frontend `test:unit` references Jest, but Jest is not installed; only
  Playwright E2E exists. Playwright config expects port 3001 while `npm run dev`
  starts 3000 — start the dev server manually on 3001 before `npm run test`.
- **204 routes:** FastAPI 0.111 treats `-> None` as a response model and
  rejects it on `status_code=204`. Always pass `response_model=None` on 204
  route decorators (see `auth.py`, `documents.py`, `chat.py`).
- Do not edit `backend/.env`, secrets, or credentials. Never run destructive git
  or remote-changing commands; do not commit unless asked.
