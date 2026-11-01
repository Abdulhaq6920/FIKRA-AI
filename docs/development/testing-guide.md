# Testing Guide

## Test layout

```
backend/tests/
├── conftest.py               Shared fixtures (DB session, HTTP client)
├── unit/
│   ├── test_security.py      Password hashing, JWT creation/verification
│   ├── test_ingestion.py     Text extraction, chunking, normalization
│   └── test_retrieval.py     RRF fusion, citation extraction
├── integration/
│   ├── test_auth_api.py      Login, register, /me, logout via HTTP
│   ├── test_document_api.py  Upload, list, tenant isolation for documents
│   └── test_conversation_isolation.py  Cross-tenant conversation access
└── tenant_isolation/
    └── test_isolation.py     Unit-level isolation logic proofs
```

---

## Running tests

### Unit tests only (no database needed)

```powershell
cd backend
cmd /c ".venv\Scripts\python.exe -m pytest tests/unit/ tests/tenant_isolation/ -v --override-ini=addopts="
```

These run in ~1 second and require only:
- pydantic, pydantic-settings
- PyJWT, passlib[argon2]
- markdown, beautifulsoup4, lxml
- sqlalchemy, aiosqlite

### Integration tests (require PostgreSQL)

```powershell
# Start PostgreSQL first
docker compose up -d postgres

# Run integration tests against real DB
cd backend
cmd /c ".venv\Scripts\python.exe -m pytest tests/integration/ -v --override-ini=addopts="
```

Or use a test database URL:

```powershell
$env:TEST_DATABASE_URL = "postgresql+asyncpg://postgres:root@localhost:5432/rag-prod AI_test"
cmd /c ".venv\Scripts\python.exe -m pytest tests/integration/ -v --override-ini=addopts="
```

### Full suite with coverage

```powershell
cd backend
cmd /c ".venv\Scripts\python.exe -m pytest tests/unit/ tests/tenant_isolation/ -v"
# Coverage report written to htmlcov/
```

---

## How to run tests — the recommended wrapper

Because PowerShell swallows subprocess output in some configurations, use `cmd /c`:

```powershell
cmd /c ".venv\Scripts\python.exe -m pytest tests/unit/ -v --tb=short"
```

---

## Test database

Integration tests use SQLite in-memory by default (no setup needed):

```python
# conftest.py
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "sqlite+aiosqlite:///:memory:",
)
```

**Note**: SQLite doesn't support pgvector. Vector similarity tests require PostgreSQL with pgvector installed. Set `TEST_DATABASE_URL` to a real PostgreSQL URL for full integration coverage.

---

## Writing a new test

### Unit test example

```python
# tests/unit/test_my_feature.py
from app.services.my_service import my_function

class TestMyFeature:
    def test_basic_case(self):
        result = my_function("input")
        assert result == "expected"
```

No fixtures needed for pure logic tests.

### Integration test example

```python
# tests/integration/test_my_api.py
import pytest
from httpx import AsyncClient

class TestMyEndpoint:
    async def test_returns_200(self, client: AsyncClient):
        # client fixture is provided by conftest.py
        # it uses the test DB and cleans up after each test
        res = await client.get("/api/v1/health/live")
        assert res.status_code == 200
```

### Tenant isolation test example

```python
# tests/tenant_isolation/test_my_isolation.py

def test_org_a_cannot_see_org_b_data():
    """
    SECURITY TEST — always include this docstring explaining what is being proven.
    """
    # Arrange: create data scoped to org B
    # Act: call function/endpoint as org A
    # Assert: org A gets 404 or empty result
    ...
```

---

## Mocking the Groq client

Never make live Groq API calls in ordinary tests. Use a mock:

```python
from unittest.mock import AsyncMock, patch
from app.providers.groq_client import GenerationResult, UsageMetadata

mock_result = GenerationResult(
    content="The answer is [Source 1].",
    usage=UsageMetadata(model="llama3-8b-8192", input_tokens=100, output_tokens=20, total_tokens=120),
)

with patch("app.services.rag_service.GroqClient.generate", new=AsyncMock(return_value=mock_result)):
    # run code that calls RAGService.answer()
    ...
```

For live smoke tests (opt-in only):

```powershell
$env:RUN_LIVE_GROQ_TESTS = "1"
cmd /c ".venv\Scripts\python.exe -m pytest tests/ -k live -v"
```

---

## Warnings in test output

Three deprecation warnings are expected and harmless:

1. `asyncio_default_fixture_loop_scope` — suppressed by `asyncio_default_fixture_loop_scope = "function"` in `pyproject.toml`
2. `passlib argon2.__version__` — passlib using deprecated argon2-cffi API; will be fixed in a future passlib release
3. `asyncio.DefaultEventLoopPolicy` deprecated in Python 3.15 — removed from conftest; no longer appears

---

## CI integration

Add to your CI pipeline (GitHub Actions example):

```yaml
- name: Run unit tests
  working-directory: backend
  run: |
    uv venv .venv
    uv pip install -e ".[dev]"
    python -m pytest tests/unit/ tests/tenant_isolation/ -v --override-ini=addopts=
```
