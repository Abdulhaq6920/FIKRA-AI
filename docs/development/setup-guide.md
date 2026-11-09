# Development Setup Guide

This guide takes you from a clean machine to a running FIKRA AI development environment.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker Desktop | 4.x+ | https://docker.com/products/docker-desktop |
| Python | 3.12 | https://python.org or `uv python install 3.12` |
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

Edit `backend\.env` and choose a model provider. For the Ollama model you
already downloaded:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:8b
SECRET_KEY=<generate below>
JWT_SECRET_KEY=<generate below>
```

Keep Ollama running while you use the app. If you run the backend in Docker
Desktop, use `OLLAMA_BASE_URL=http://host.docker.internal:11434`. To use Groq
instead, set `LLM_PROVIDER=groq` and add a Groq API key.

Generate secure secrets:
```powershell
python -c "import secrets; print(secrets.token_hex(64))"
```

---

## Step 2: Start infrastructure (PostgreSQL + Redis)

```powershell
docker compose up -d postgres redis

# Verify both services are healthy
docker compose ps
```

---

## Step 3: Create the shared Python environment and install backend dependencies

```powershell
# From the repository root. Python 3.12 supports the pinned PyTorch version.
uv python install 3.12
uv venv --python 3.12 .venv

# Install backend dependencies into the shared root environment
cd backend

# Install all dependencies including dev tools
uv pip install --python ..\.venv\Scripts\python.exe -e ".[dev]"
```

> **Note**: `torch` and `sentence-transformers` are large (~2 GB).
> The embedding and reranker models (~130 MB each) are downloaded from HuggingFace on first use.
> Set `HF_HUB_OFFLINE=1` after first download to prevent repeated network checks.

---

## Step 4: Run database migrations

```powershell
# From backend/, use the shared root environment
..\.venv\Scripts\python.exe -m alembic upgrade head

# Verify
..\.venv\Scripts\python.exe -m alembic current
# Expected: 0001 (head)
```

---

## Step 5: Create initial organization and admin user

```powershell
..\.venv\Scripts\python.exe ..\scripts\create_initial_org.py
```

Creates:
- Organization: `Demo Organization` (id: `00000000-0000-0000-0000-000000000001`)
- Platform admin: `admin@FIKRA AI.ai` / `Admin1234!`

> Change this password immediately after first login.

---

## Step 6: Start the backend

```powershell
# From backend/, use the shared root environment
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Verify:
- http://localhost:8000/api/v1/health/live → `{"status":"ok","app":"FIKRA AI"}`
- http://localhost:8000/api/docs → Swagger UI

---

## Step 7: Start the Celery worker

Open a new terminal:

```powershell
# From the repository root
cd backend
..\.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion
```

---

## Step 8: Frontend

```powershell
# In a new terminal from the repository root
cd frontend
npm.cmd install --legacy-peer-deps
npm.cmd run dev
```

Open: http://localhost:3000

## Install OpenCode CLI

OpenCode is a Node.js CLI, not a Python package. If it is not already installed, install it with npm:

```powershell
npm.cmd install --global opencode-ai
opencode.cmd --version
```

---

## Step 9: Run tests

```powershell
cd backend

# Unit tests — no database or external services needed
..\.venv\Scripts\python.exe -m pytest tests/unit/ -v

# Tenant isolation unit tests
..\.venv\Scripts\python.exe -m pytest tests/tenant_isolation/ -v

# Integration tests — require PostgreSQL running
..\.venv\Scripts\python.exe -m pytest tests/integration/ -v

# All tests with coverage
..\.venv\Scripts\python.exe -m pytest -v --cov=app --cov-report=term-missing
```

---

## Step 10: Linting and type checking

```powershell
# Linting + formatting (auto-fix)
..\.venv\Scripts\ruff.exe check app/ --fix
..\.venv\Scripts\ruff.exe format app/

# Type checking
..\.venv\Scripts\mypy.exe app/
```

---

## Common issues

### "GROQ_API_KEY is not configured"
Set `LLM_PROVIDER=groq` and `GROQ_API_KEY=gsk_...` in `backend/.env`, or set
`LLM_PROVIDER=ollama` to use your local Ollama server without a Groq key.

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
