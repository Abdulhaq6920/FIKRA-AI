"""
Health and readiness check endpoints.

GET /api/v1/health/live     — liveness probe (always fast, no dependencies)
GET /api/v1/health/ready    — readiness probe (required dependencies only)
GET /api/v1/health/startup  — one-shot startup check (migrations + model warm)

Contract:
- ``/live`` never touches the database, Redis or the model. It must stay under a
  few milliseconds so a slow upload cannot make the orchestrator kill the pod.
- ``/ready`` fails (503) only on **required** dependencies: PostgreSQL and the
  embedding model (retrieval cannot answer without it). Redis and Celery are
  reported as ``degraded`` — the app degrades to inline ingestion by design, so
  taking the instance out of rotation for them would remove capacity needlessly.
- ``/startup`` reports whether the process is fully initialised: migrations at
  head and the embedding model loaded.

These endpoints do NOT require authentication.
They do NOT include sensitive configuration details.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db

router = APIRouter(prefix="/health", tags=["health"])

# Cached so a scrape storm does not query alembic_version on every probe.
_migration_state: dict[str, str] = {}


@router.get("/live")
async def liveness() -> dict[str, str]:
    """Always returns 200. Used by Docker/k8s to check if the process is running."""
    return {"status": "ok", "app": settings.app_name}


@router.get("/ready")
async def readiness(db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """
    Returns 200 when the required dependencies are ready, 503 otherwise.

    Required: PostgreSQL, embedding model loaded.
    Reported but non-fatal: Redis (degrades to inline ingestion), Celery worker.
    """
    checks: dict[str, str] = {}

    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"

    from app.providers.embeddings import is_model_loaded

    checks["embedding_model"] = "ok" if is_model_loaded() else "not_loaded"

    from app.core.redis import ping_redis

    try:
        await ping_redis()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"degraded: {type(exc).__name__}"

    required_ok = checks["database"] == "ok" and checks["embedding_model"] == "ok"
    degraded = any(value != "ok" for value in checks.values())

    return JSONResponse(
        status_code=200 if required_ok else 503,
        content={
            "status": "ready" if required_ok and not degraded else ("ready" if required_ok else "degraded"),
            "checks": checks,
        },
    )


@router.get("/startup")
async def startup(db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """One-shot check: are migrations applied and is the model warm?"""
    checks: dict[str, str] = {}

    try:
        current = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        checks["migrations"] = f"at_head:{current}"
    except Exception as exc:
        checks["migrations"] = f"error: {type(exc).__name__}"

    from app.providers.embeddings import is_model_loaded

    checks["embedding_model"] = "ok" if is_model_loaded() else "not_loaded"

    ready = checks["migrations"].startswith("at_head") and checks["embedding_model"] == "ok"
    payload: dict[str, Any] = {"status": "started" if ready else "starting", "checks": checks}
    return JSONResponse(status_code=200 if ready else 503, content=payload)
