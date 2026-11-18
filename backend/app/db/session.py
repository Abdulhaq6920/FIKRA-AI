"""
Async SQLAlchemy engine and session factory.

Usage in FastAPI endpoints via the dependency:

    async def my_endpoint(db: AsyncSession = Depends(get_db)):
        ...

The session is committed automatically on success and rolled back on any
exception, then closed. Never call session.commit() directly in route
handlers — use the service layer where appropriate.

Cloud / Neon notes:
- Set DATABASE_SSL=true in your .env when connecting to Neon or any cloud
  Postgres. asyncpg requires ssl="require" in connect_args (not in the URL).
- Set DATABASE_POOL_SIZE=5 and DATABASE_MAX_OVERFLOW=5 for Neon free tier
  (max 10 simultaneous connections on the pooled endpoint).
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
# SSL connect_args — required for Neon and most cloud Postgres providers.
# asyncpg does NOT read sslmode from the URL; it must be passed here.
# ---------------------------------------------------------------------------
_connect_args: dict[str, Any] = {}
if settings.database_ssl:
    _connect_args["ssl"] = "require"

# ---------------------------------------------------------------------------
# ivfflat.probes — how many inverted lists an ANN query visits.
#
# pgvector's default is 1, which searches ~1% of a 100-list index and returns
# noticeably worse neighbours than an exhaustive scan. It is a per-connection
# setting, so it must be applied when the connection is established, not per
# query. Only asyncpg understands `server_settings`; a SQLite URL (used by some
# local tooling) must not receive it.
# ---------------------------------------------------------------------------
if settings.database_url.startswith("postgresql+asyncpg"):
    _connect_args["server_settings"] = {
        "ivfflat.probes": str(settings.vector_index_probes),
    }

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
_engine_kwargs: dict[str, Any] = {
    # Statement logging is opt-in (SQL_ECHO=true). Tying it to DEBUG flooded the
    # log pipeline with every query plus its bound parameters in development.
    "echo": settings.sql_echo,
    "pool_size": settings.database_pool_size,
    "max_overflow": settings.database_max_overflow,
    "pool_timeout": settings.database_pool_timeout,
    "pool_pre_ping": True,  # detect stale connections
    "pool_recycle": 1800,  # recycle connections after 30 minutes
    "connect_args": _connect_args,
}

engine = create_async_engine(settings.database_url, **_engine_kwargs)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,  # avoids lazy-load issues after commit in async
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
