"""
Integration tests for organization user management (``/api/v1/admin/users``).

Covers:
- listing, search, and filters (tenant-scoped)
- user creation and duplicate-email handling
- role / active-state updates
- safety guards: self-role change, self-deactivation, last active admin,
  platform-admin protection
- cross-tenant access returns 404
- non-admin access returns 403
- password reset and session revocation
- deactivation blocks login and revokes sessions

These tests require PostgreSQL because the models use ``UUID``/``JSONB``/
``Vector`` columns. Set ``TEST_DATABASE_URL`` to a disposable database.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.audit import AuditLog
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import (
    OrganizationMembership,
    OrgRole,
    RefreshSession,
    User,
    UserStatus,
)

ORG_ID = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
OTHER_ORG_ID = uuid.UUID("cccccccc-0000-0000-0000-000000000002")

DEFAULT_PASSWORD = "TestPass1!"


# ─── Helpers ──────────────────────────────────────────────────────────────


async def _make_user(
    db: AsyncSession,
    org_id: uuid.UUID,
    *,
    email: str,
    full_name: str,
    role: OrgRole = OrgRole.MEMBER,
    is_platform_admin: bool = False,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        email_normalized=email.lower(),
        hashed_password=hash_password(DEFAULT_PASSWORD),
        full_name=full_name,
        status=UserStatus.ACTIVE,
        is_platform_admin=is_platform_admin,
    )
    db.add(user)
    await db.flush()
    db.add(
        OrganizationMembership(
            user_id=user.id,
            organization_id=org_id,
            role=role,
            is_active=is_active,
        )
    )
    await db.flush()
    return user


async def _login(client: AsyncClient, email: str, password: str = DEFAULT_PASSWORD) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": password,
            "organization_id": str(ORG_ID),
        },
    )
    assert res.status_code == 200, res.text


# ─── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
async def test_org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=ORG_ID,
        name="User Management Org",
        slug="user-management-org",
        status=OrganizationStatus.ACTIVE,
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def other_org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=OTHER_ORG_ID,
        name="Other Tenant",
        slug="other-tenant",
        status=OrganizationStatus.ACTIVE,
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def admin_user(db_session: AsyncSession, test_org: Organization) -> User:
    return await _make_user(
        db_session,
        ORG_ID,
        email="org-admin@example.com",
        full_name="Org Admin",
        role=OrgRole.ORG_ADMIN,
    )


@pytest.fixture
async def member_user(db_session: AsyncSession, test_org: Organization) -> User:
    return await _make_user(
        db_session,
        ORG_ID,
        email="member@example.com",
        full_name="Regular Member",
        role=OrgRole.MEMBER,
    )


@pytest.fixture
async def platform_admin_user(db_session: AsyncSession, test_org: Organization) -> User:
    """A platform admin whose org membership is a plain member."""
    return await _make_user(
        db_session,
        ORG_ID,
        email="platform-admin@example.com",
        full_name="Platform Admin",
        role=OrgRole.MEMBER,
        is_platform_admin=True,
    )


@pytest.fixture
async def other_tenant_user(db_session: AsyncSession, other_org: Organization) -> User:
    return await _make_user(
        db_session,
        OTHER_ORG_ID,
        email="other@example.com",
        full_name="Other Tenant User",
        role=OrgRole.MEMBER,
    )


# ─── Tests ────────────────────────────────────────────────────────────────


class TestListUsers:
    async def test_lists_only_current_tenant(
        self,
        client: AsyncClient,
        admin_user: User,
        member_user: User,
        other_tenant_user: User,
    ):
        await _login(client, admin_user.email)

        res = await client.get("/api/v1/admin/users")
        assert res.status_code == 200, res.text
        data = res.json()
        emails = {item["email"] for item in data["items"]}

        assert emails == {admin_user.email, member_user.email}
        assert other_tenant_user.email not in emails
        assert data["total"] == 2

        by_email = {item["email"]: item for item in data["items"]}
        assert by_email[admin_user.email]["role"] == "admin"
        assert by_email[admin_user.email]["is_self"] is True
        assert by_email[member_user.email]["role"] == "member"
        assert by_email[member_user.email]["is_self"] is False
        # Credentials must never be exposed.
        assert "hashed_password" not in res.text
        assert "password" not in res.text

    async def test_search_filters_by_name_and_email(
        self, client: AsyncClient, admin_user: User, member_user: User
    ):
        await _login(client, admin_user.email)

        res = await client.get("/api/v1/admin/users", params={"search": "regular"})
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 1
        assert data["items"][0]["email"] == member_user.email

        res = await client.get("/api/v1/admin/users", params={"search": "ORG-ADMIN@"})
        assert res.status_code == 200
        assert [item["email"] for item in res.json()["items"]] == [admin_user.email]

    async def test_role_and_status_filters(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User
    ):
        inactive = await _make_user(
            db_session,
            ORG_ID,
            email="inactive@example.com",
            full_name="Inactive User",
            role=OrgRole.MEMBER,
            is_active=False,
        )
        await _login(client, admin_user.email)

        res = await client.get("/api/v1/admin/users", params={"role": "admin"})
        assert res.status_code == 200
        assert [item["email"] for item in res.json()["items"]] == [admin_user.email]

        res = await client.get("/api/v1/admin/users", params={"is_active": "false"})
        assert res.status_code == 200
        assert [item["email"] for item in res.json()["items"]] == [inactive.email]

    async def test_non_admin_is_forbidden(self, client: AsyncClient, member_user: User):
        await _login(client, member_user.email)
        res = await client.get("/api/v1/admin/users")
        assert res.status_code == 403


class TestCreateUser:
    async def test_create_member(
        self, client: AsyncClient, db_session: AsyncSession, admin_user: User
    ):
        await _login(client, admin_user.email)

        res = await client.post(
            "/api/v1/admin/users",
            json={
                "email": "New.Member@Example.com",
                "full_name": "New Member",
                "password": "BrandNew123!",
                "role": "member",
            },
        )
        assert res.status_code == 201, res.text
        data = res.json()
        # EmailStr canonicalizes the domain to lowercase.
        assert data["email"] == "New.Member@example.com"
        assert data["role"] == "member"
        assert data["is_active"] is True
        assert data["account_status"] == "active"
        assert data["is_platform_admin"] is False

        # Persisted with a normalized email and hashed password.
        created = await db_session.scalar(
            select(User).where(User.email_normalized == "new.member@example.com")
        )
        assert created is not None
        assert created.hashed_password != "BrandNew123!"
        membership = await db_session.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == created.id,
                OrganizationMembership.organization_id == ORG_ID,
            )
        )
        assert membership is not None and membership.role == OrgRole.MEMBER

        # Audited without secrets.
        audit = await db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "user.created",
                AuditLog.resource_id == str(created.id),
            )
        )
        assert audit is not None
        assert audit.organization_id == ORG_ID
        assert "password" not in str(audit.details).lower()

    async def test_create_admin_role(self, client: AsyncClient, admin_user: User):
        await _login(client, admin_user.email)
        res = await client.post(
            "/api/v1/admin/users",
            json={
                "email": "second-admin@example.com",
                "full_name": "Second Admin",
                "password": "BrandNew123!",
                "role": "admin",
            },
        )
        assert res.status_code == 201, res.text
        assert res.json()["role"] == "admin"

    async def test_duplicate_email_returns_409(
        self, client: AsyncClient, admin_user: User, member_user: User
    ):
        await _login(client, admin_user.email)
        res = await client.post(
            "/api/v1/admin/users",
            json={
                "email": member_user.email.upper(),
                "full_name": "Duplicate",
                "password": "BrandNew123!",
                "role": "member",
            },
        )
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"

    async def test_invalid_payload_returns_422(self, client: AsyncClient, admin_user: User):
        await _login(client, admin_user.email)
        res = await client.post(
            "/api/v1/admin/users",
            json={
                "email": "not-an-email",
                "full_name": "",
                "password": "short",
                "role": "member",
            },
        )
        assert res.status_code == 422


class TestUpdateUser:
    async def test_update_name_role_and_reactivate(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        await _login(client, admin_user.email)

        res = await client.patch(
            f"/api/v1/admin/users/{member_user.id}",
            json={"full_name": "Renamed Member", "role": "admin"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["full_name"] == "Renamed Member"
        assert data["role"] == "admin"

        res = await client.patch(f"/api/v1/admin/users/{member_user.id}", json={"is_active": False})
        assert res.status_code == 200, res.text
        assert res.json()["is_active"] is False
        assert res.json()["account_status"] == "disabled"

        res = await client.patch(f"/api/v1/admin/users/{member_user.id}", json={"is_active": True})
        assert res.status_code == 200
        assert res.json()["is_active"] is True
        assert res.json()["account_status"] == "active"

        await db_session.refresh(member_user)
        assert member_user.status == UserStatus.ACTIVE

    async def test_empty_update_is_rejected(
        self, client: AsyncClient, admin_user: User, member_user: User
    ):
        await _login(client, admin_user.email)
        res = await client.patch(f"/api/v1/admin/users/{member_user.id}", json={})
        assert res.status_code == 422

    async def test_cannot_change_own_role(self, client: AsyncClient, admin_user: User):
        await _login(client, admin_user.email)
        res = await client.patch(f"/api/v1/admin/users/{admin_user.id}", json={"role": "member"})
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "PERMISSION_DENIED"

    async def test_cannot_deactivate_self(self, client: AsyncClient, admin_user: User):
        await _login(client, admin_user.email)
        res = await client.patch(f"/api/v1/admin/users/{admin_user.id}", json={"is_active": False})
        assert res.status_code == 403

    async def test_cannot_demote_last_active_admin(
        self, client: AsyncClient, admin_user: User, platform_admin_user: User
    ):
        """A non-org-admin actor must not remove the final active org admin."""
        await _login(client, platform_admin_user.email)
        res = await client.patch(f"/api/v1/admin/users/{admin_user.id}", json={"role": "member"})
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "CONFLICT"

    async def test_org_admin_cannot_modify_platform_admin(
        self,
        client: AsyncClient,
        admin_user: User,
        platform_admin_user: User,
    ):
        await _login(client, admin_user.email)
        res = await client.patch(
            f"/api/v1/admin/users/{platform_admin_user.id}",
            json={"is_active": False},
        )
        assert res.status_code == 403

    async def test_cross_tenant_user_returns_404(
        self,
        client: AsyncClient,
        admin_user: User,
        other_tenant_user: User,
    ):
        await _login(client, admin_user.email)
        res = await client.patch(
            f"/api/v1/admin/users/{other_tenant_user.id}",
            json={"full_name": "Hijacked"},
        )
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "USER_NOT_FOUND"

    async def test_unknown_user_returns_404(self, client: AsyncClient, admin_user: User):
        await _login(client, admin_user.email)
        res = await client.patch(f"/api/v1/admin/users/{uuid.uuid4()}", json={"full_name": "Ghost"})
        assert res.status_code == 404

    async def test_member_cannot_manage_users(
        self, client: AsyncClient, member_user: User, admin_user: User
    ):
        await _login(client, member_user.email)
        res = await client.patch(f"/api/v1/admin/users/{admin_user.id}", json={"full_name": "Nope"})
        assert res.status_code == 403


class TestPasswordReset:
    async def test_reset_password_revokes_sessions(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        # Member signs in first, creating a refresh session.
        await _login(client, member_user.email)
        session = await db_session.scalar(
            select(RefreshSession).where(RefreshSession.user_id == member_user.id)
        )
        assert session is not None and session.is_revoked is False

        # Admin resets the password.
        await _login(client, admin_user.email)
        res = await client.post(
            f"/api/v1/admin/users/{member_user.id}/reset-password",
            json={"new_password": "ChangedPass123!"},
        )
        assert res.status_code == 204, res.text

        await db_session.refresh(session)
        assert session.is_revoked is True

        # New password works; the old one does not.
        res = await client.post(
            "/api/v1/auth/login",
            json={
                "email": member_user.email,
                "password": "ChangedPass123!",
                "organization_id": str(ORG_ID),
            },
        )
        assert res.status_code == 200, res.text

        client.cookies.clear()
        res = await client.post(
            "/api/v1/auth/login",
            json={
                "email": member_user.email,
                "password": DEFAULT_PASSWORD,
                "organization_id": str(ORG_ID),
            },
        )
        assert res.status_code == 401

    async def test_reset_password_too_short_returns_422(
        self, client: AsyncClient, admin_user: User, member_user: User
    ):
        await _login(client, admin_user.email)
        res = await client.post(
            f"/api/v1/admin/users/{member_user.id}/reset-password",
            json={"new_password": "short"},
        )
        assert res.status_code == 422

    async def test_org_admin_cannot_reset_platform_admin_password(
        self,
        client: AsyncClient,
        admin_user: User,
        platform_admin_user: User,
    ):
        await _login(client, admin_user.email)
        res = await client.post(
            f"/api/v1/admin/users/{platform_admin_user.id}/reset-password",
            json={"new_password": "ChangedPass123!"},
        )
        assert res.status_code == 403

    async def test_cross_tenant_password_reset_returns_404(
        self,
        client: AsyncClient,
        admin_user: User,
        other_tenant_user: User,
    ):
        await _login(client, admin_user.email)
        res = await client.post(
            f"/api/v1/admin/users/{other_tenant_user.id}/reset-password",
            json={"new_password": "ChangedPass123!"},
        )
        assert res.status_code == 404


class TestDeactivation:
    async def test_deactivate_revokes_sessions_and_blocks_login(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        await _login(client, member_user.email)
        session = await db_session.scalar(
            select(RefreshSession).where(RefreshSession.user_id == member_user.id)
        )
        assert session is not None and session.is_revoked is False

        await _login(client, admin_user.email)
        res = await client.patch(f"/api/v1/admin/users/{member_user.id}", json={"is_active": False})
        assert res.status_code == 200
        await db_session.refresh(session)
        assert session.is_revoked is True

        client.cookies.clear()
        res = await client.post(
            "/api/v1/auth/login",
            json={
                "email": member_user.email,
                "password": DEFAULT_PASSWORD,
                "organization_id": str(ORG_ID),
            },
        )
        assert res.status_code == 401
