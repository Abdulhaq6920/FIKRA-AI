"""
Async SQLAlchemy engine and session factory.

Usage in FastAPI endpoints via the dependency:

    async def my_endpoint(db: AsyncSession = Depends(get_db)):
        ...

The session is committed automatically on success and rolled back on any
exception, then closed. Never call session.commit() directly in route
handlers — use the service layer where appropriate.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
_engine_kwargs: dict[str, Any] = {
    "echo": settings.debug,
    "pool_size": settings.database_pool_size,
    "max_overflow": settings.database_max_overflow,
    "pool_timeout": settings.database_pool_timeout,
    "pool_pre_ping": True,      # detect stale connections
    "pool_recycle": 1800,       # recycle connections after 30 minutes
}

engine = create_async_engine(settings.database_url, **_engine_kwargs)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,   # avoids lazy-load issues after commit in async
    autocommit=False,
    autoflush=False,
)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield an async database session.

    - Commits on success.
    - Rolls back on any exception.
    - Always closes the session when the request is done.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
