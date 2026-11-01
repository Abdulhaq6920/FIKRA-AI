# Development Setup Guide

This guide takes you from a clean machine to a running FIKRA AI development environment.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker Desktop | 4.x+ | https://docker.com/products/docker-desktop |
| Python | 3.11+ | https://python.org or `pyenv` |
| Node.js | 20 LTS | https://nodejs.org or `nvm` |
| uv | latest | https://docs.astral.sh/uv/getting-started/installation/ |
| Git | 2.x+ | Pre-installed on most systems |

> **Why uv?** uv is a fast Rust-based Python package manager that replaces `pip` + `venv`.
> It resolves and installs dependencies significantly faster and produces reproducible environments.
> Install it with: `pip install uv` or via the standalone installer at the link above.

---

## Step 1: Clone and configure environment

```powershell
cd C:\Users\Lenovo\Desktop\RAG

# Copy the example environment file
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env` and fill in:

```env
GROQ_API_KEY=gsk_your_actual_key_here
SECRET_KEY=<generate below>
JWT_SECRET_KEY=<generate below>
```

Generate secure secrets:
```powershell
python -c "import secrets; print(secrets.token_hex(64))"
```

Get a Groq API key at https://console.groq.com (free tier available).

---

## Step 2: Start infrastructure (PostgreSQL + Redis)

```powershell
docker compose up -d postgres redis

# Verify both services are healthy
docker compose ps
```

---

## Step 3: Backend — create venv and install dependencies

```powershell
cd backend

# Create the virtual environment with uv
uv venv .venv

# Activate it (Windows PowerShell)
.venv\Scripts\activate

# Install all dependencies including dev tools
uv pip install -e ".[dev]"
```

> **Note**: `torch` and `sentence-transformers` are large (~2 GB).
> The embedding and reranker models (~130 MB each) are downloaded from HuggingFace on first use.
> Set `HF_HUB_OFFLINE=1` after first download to prevent repeated network checks.

---

## Step 4: Run database migrations

```powershell
# In backend/ with .venv activated
alembic upgrade head

# Verify
alembic current
# Expected: 0001 (head)
```

---

## Step 5: Create initial organization and admin user

```powershell
python ..\scripts\create_initial_org.py
```

Creates:
- Organization: `Demo Organization` (id: `00000000-0000-0000-0000-000000000001`)
- Platform admin: `admin@FIKRA AI.ai` / `Admin1234!`

> Change this password immediately after first login.

---

## Step 6: Start the backend

```powershell
# In backend/ with .venv activated
uvicorn app.main:app --reload --port 8000
```

Verify:
- http://localhost:8000/api/v1/health/live → `{"status":"ok","app":"FIKRA AI"}`
- http://localhost:8000/api/docs → Swagger UI

---

## Step 7: Start the Celery worker

Open a new terminal:

```powershell
cd backend
.venv\Scripts\activate
celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion
```

---

## Step 8: Frontend

```powershell
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open: http://localhost:3000

---

## Step 9: Run tests

```powershell
cd backend
.venv\Scripts\activate

# Unit tests — no database or external services needed
pytest tests/unit/ -v

# Tenant isolation unit tests
pytest tests/tenant_isolation/ -v

# Integration tests — require PostgreSQL running
pytest tests/integration/ -v

# All tests with coverage
pytest -v --cov=app --cov-report=term-missing
```

---

## Step 10: Linting and type checking

```powershell
# Linting + formatting (auto-fix)
ruff check app/ --fix
ruff format app/

# Type checking
mypy app/
```

---

## Common issues

### "GROQ_API_KEY is not configured"
Set `GROQ_API_KEY=gsk_...` in `backend/.env`. The app fails at startup if missing.

### "pgvector extension not found"
Use the `pgvector/pgvector:pg16` Docker image, not plain `postgres:16`.

### uv install fails for torch on Python 3.15
Run:
```powershell
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
```

### Embedding model download hangs
First run downloads ~130 MB from HuggingFace. After first download set:
```env
HF_HUB_OFFLINE=1
```

### Port already in use
Change ports in `docker-compose.yml` or kill conflicting processes:
```powershell
netstat -ano | findstr :5432   # find PID
Stop-Process -Id <PID>
```

---

## Stopping everything

```powershell
# Stop Docker services (keeps data volumes)
docker compose down

# Nuclear option — stops AND deletes all data
docker compose down -v   # Only run this intentionally!
```
