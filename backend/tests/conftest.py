"""
Shared pytest fixtures for the FIKRA AI test suite.

Database tests use an in-memory SQLite backend by default unless
the environment variable USE_POSTGRES_TEST=1 is set.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

# Rate limiting is in-process and keyed by client IP; the whole integration
# suite shares one testclient IP and routinely exceeds the login limit.
# Settings are cached at first import of app.main, so set this first.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app as fastapi_app

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "sqlite+aiosqlite:///:memory:",
)


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create a test database engine. Session-scoped so schema is created once."""
    # NullPool: pytest-asyncio runs each test in its own event loop, so pooled
    # asyncpg/aiosqlite connections must not be reused across loops (reuse
    # raises "another operation is in progress").
    engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session that is rolled back after each test."""
    async_session = async_sessionmaker(
        bind=test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
        await session.rollback()


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    HTTPX async client wired to the FastAPI app.
    The database dependency is overridden to use the test session.
    """

    async def override_get_db():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as ac:
        yield ac
    fastapi_app.dependency_overrides.clear()
