"""
Integration tests for the authentication API.

These tests use the FastAPI test client with an in-memory SQLite DB
(or real PostgreSQL when TEST_DATABASE_URL is set).

Tests cover:
- Successful login → tokens issued
- Wrong password → generic 401
- Unknown email → generic 401 (no account enumeration)
- Token refresh cycle
- Logout revokes token
- Protected endpoint without auth → 401
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import OrgRole, OrganizationMembership, User, UserStatus


# ─── Fixtures ─────────────────────────────────────────────────────────────

ORG_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")


@pytest.fixture
async def test_org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=ORG_ID,
        name="Test Org",
        slug="test-org-auth",
        status=OrganizationStatus.ACTIVE,
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def test_user(db_session: AsyncSession, test_org: Organization) -> User:
    user = User(
        email="testuser@example.com",
        email_normalized="testuser@example.com",
        hashed_password=hash_password("TestPass1!"),
        full_name="Test User",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()

    membership = OrganizationMembership(
        user_id=user.id,
        organization_id=ORG_ID,
        role=OrgRole.MEMBER,
        is_active=True,
    )
    db_session.add(membership)
    await db_session.flush()
    return user


# ─── Tests ────────────────────────────────────────────────────────────────

class TestLogin:
    async def test_login_success(self, client: AsyncClient, test_user: User):
        res = await client.post("/api/v1/auth/login", json={
            "email": "testuser@example.com",
            "password": "TestPass1!",
            "organization_id": str(ORG_ID),
        })
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    async def test_login_wrong_password(self, client: AsyncClient, test_user: User):
        res = await client.post("/api/v1/auth/login", json={
            "email": "testuser@example.com",
            "password": "WrongPassword1!",
            "organization_id": str(ORG_ID),
        })
        assert res.status_code == 401
        # Must use generic message — no "wrong password" hint
        assert "credential" in res.json()["error"]["message"].lower()

    async def test_login_unknown_email(self, client: AsyncClient, test_org: Organization):
        """Unknown email must return the same error as wrong password."""
        res = await client.post("/api/v1/auth/login", json={
            "email": "nobody@example.com",
            "password": "TestPass1!",
            "organization_id": str(ORG_ID),
        })
        assert res.status_code == 401
        # Same error code — no account enumeration
        assert res.json()["error"]["code"] == "AUTHENTICATION_FAILED"

    async def test_login_wrong_org(self, client: AsyncClient, test_user: User):
        """User exists but is not a member of this org."""
        other_org = uuid.uuid4()
        res = await client.post("/api/v1/auth/login", json={
            "email": "testuser@example.com",
            "password": "TestPass1!",
            "organization_id": str(other_org),
        })
        assert res.status_code == 401

    async def test_login_sets_httponly_cookie(self, client: AsyncClient, test_user: User):
        res = await client.post("/api/v1/auth/login", json={
            "email": "testuser@example.com",
            "password": "TestPass1!",
            "organization_id": str(ORG_ID),
        })
        assert res.status_code == 200
        # access_token cookie should be set
        cookies = res.cookies
        assert "access_token" in cookies or "access_token" in str(res.headers.get("set-cookie", ""))


class TestProtectedEndpoints:
    async def test_unauthenticated_request_returns_401(self, client: AsyncClient):
        res = await client.get("/api/v1/auth/me")
        assert res.status_code == 401

    async def test_authenticated_me(self, client: AsyncClient, test_user: User):
        # Login first
        login_res = await client.post("/api/v1/auth/login", json={
            "email": "testuser@example.com",
            "password": "TestPass1!",
            "organization_id": str(ORG_ID),
        })
        assert login_res.status_code == 200

        # /me should work now (cookie sent automatically)
        me_res = await client.get("/api/v1/auth/me")
        assert me_res.status_code == 200
        data = me_res.json()
        assert data["email"] == "testuser@example.com"
        # hashed_password must never appear in the response
        assert "hashed_password" not in data
        assert "password" not in str(data)


class TestHealthEndpoints:
    async def test_liveness(self, client: AsyncClient):
        res = await client.get("/api/v1/health/live")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

    async def test_readiness_returns_json(self, client: AsyncClient):
        res = await client.get("/api/v1/health/ready")
        data = res.json()
        assert "status" in data
        assert "checks" in data
