"""
Health and readiness check endpoints.

GET /api/v1/health/live    — liveness probe (always fast)
GET /api/v1/health/ready   — readiness probe (checks dependencies)

These endpoints do NOT require authentication.
They do NOT include sensitive configuration details.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def liveness() -> dict:
    """Always returns 200. Used by Docker/k8s to check if the process is running."""
    return {"status": "ok", "app": settings.app_name}


@router.get("/ready")
async def readiness(db: AsyncSession = Depends(get_db)) -> dict:
    """
    Returns 200 when all required dependencies are ready.
    Returns 503 when any dependency is unavailable.

    Checks:
    - PostgreSQL connectivity
    - (Redis/Groq checks can be added here)
    """
    checks: dict[str, str] = {}

    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"

    all_ok = all(v == "ok" for v in checks.values())

    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "ready" if all_ok else "degraded", "checks": checks},
    )
