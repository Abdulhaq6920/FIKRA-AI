"""Favourite questions are per-user *and* per-tenant.

The shortcut list is a small convenience, but it is still tenant data: one
member's saved questions must never appear in another member's list, not even
inside the same organization, and a foreign id must not be deletable.

What these tests block:

* a shared list leaking one user's questions to colleagues (same-org isolation);
* a cross-tenant read or delete succeeding because only the id was checked.

Requires PostgreSQL (``TEST_DATABASE_URL``); the models use ``UUID``/``JSONB``.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import OrganizationMembership, OrgRole, User, UserStatus

PASSWORD = "TestPass1!"


async def _make_org(db: AsyncSession) -> Organization:
    """A fresh organization per call: endpoint commits outlive the rollback."""
    suffix = uuid.uuid4().hex[:12]
    org = Organization(
        name=f"Favourites Org {suffix}",
        slug=f"favourites-org-{suffix}",
        status=OrganizationStatus.ACTIVE,
    )
    db.add(org)
    await db.flush()
    return org


async def _make_user(db: AsyncSession, org_id: uuid.UUID) -> User:
    suffix = uuid.uuid4().hex[:12]
    user = User(
        email=f"member-{suffix}@example.com",
        email_normalized=f"member-{suffix}@example.com",
        hashed_password=hash_password(PASSWORD),
        full_name=f"Member {suffix}",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    db.add(
        OrganizationMembership(
            user_id=user.id,
            organization_id=org_id,
            role=OrgRole.MEMBER,
            is_active=True,
        )
    )
    await db.flush()
    return user


async def _login(client: AsyncClient, user: User, org_id: uuid.UUID) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": PASSWORD, "organization_id": str(org_id)},
    )
    assert res.status_code == 200, res.text


async def _save(client: AsyncClient, question: str) -> dict:
    res = await client.post("/api/v1/chat/favorites", json={"question": question})
    assert res.status_code == 200, res.text
    return res.json()


async def _list(client: AsyncClient) -> list[dict]:
    res = await client.get("/api/v1/chat/favorites")
    assert res.status_code == 200, res.text
    return res.json()["items"]


class TestFavouriteIsolation:
    async def test_same_org_member_cannot_see_or_delete_a_colleagues_favourite(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        org = await _make_org(db_session)
        owner = await _make_user(db_session, org.id)
        colleague = await _make_user(db_session, org.id)

        await _login(client, owner, org.id)
        saved = await _save(client, "What is our leave policy?")

        # Same organization, different user: the row must be invisible.
        await _login(client, colleague, org.id)
        assert await _list(client) == []

        res = await client.delete(f"/api/v1/chat/favorites/{saved['id']}")
        assert res.status_code == 404, "a colleague's favourite id must be a 404"

        # The owner still has it, untouched.
        await _login(client, owner, org.id)
        assert [item["id"] for item in await _list(client)] == [saved["id"]]

    async def test_other_tenant_cannot_see_or_delete_a_favourite(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        org_a = await _make_org(db_session)
        org_b = await _make_org(db_session)
        tenant_a = await _make_user(db_session, org_a.id)
        tenant_b = await _make_user(db_session, org_b.id)

        await _login(client, tenant_a, org_a.id)
        saved = await _save(client, "Which documents cover compliance?")

        await _login(client, tenant_b, org_b.id)
        assert await _list(client) == []

        res = await client.delete(f"/api/v1/chat/favorites/{saved['id']}")
        assert res.status_code == 404, "cross-tenant delete must not reveal the row"

        await _login(client, tenant_a, org_a.id)
        assert [item["question"] for item in await _list(client)] == [
            "Which documents cover compliance?"
        ]

    async def test_saving_the_same_question_is_idempotent_and_whitespace_normalised(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        org = await _make_org(db_session)
        user = await _make_user(db_session, org.id)
        await _login(client, user, org.id)

        first = await _save(client, "  What   is our leave policy?  ")
        second = await _save(client, "What is our leave policy?")

        assert first["id"] == second["id"]
        assert first["question"] == "What is our leave policy?"
        assert len(await _list(client)) == 1
