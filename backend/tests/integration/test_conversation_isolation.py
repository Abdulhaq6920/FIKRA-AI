"""
Integration tests: conversation tenant isolation.

A user from Org A must not be able to read or modify conversations
belonging to Org B — even when they know the conversation UUID.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.conversation import Conversation
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import OrgRole, OrganizationMembership, User, UserStatus

ORG_A = uuid.UUID("cccccccc-0000-0000-0000-000000000001")
ORG_B = uuid.UUID("cccccccc-0000-0000-0000-000000000002")


@pytest.fixture
async def users_in_two_orgs(db_session: AsyncSession):
    for org_id, slug in [(ORG_A, "conv-org-a"), (ORG_B, "conv-org-b")]:
        db_session.add(Organization(id=org_id, name=slug, slug=slug, status=OrganizationStatus.ACTIVE))
    await db_session.flush()

    users = {}
    for org_id, email in [(ORG_A, "user-a@example.com"), (ORG_B, "user-b@example.com")]:
        u = User(
            email=email, email_normalized=email,
            hashed_password=hash_password("UserPass1!"),
            full_name="Test", status=UserStatus.ACTIVE,
        )
        db_session.add(u)
        await db_session.flush()
        m = OrganizationMembership(user_id=u.id, organization_id=org_id, role=OrgRole.MEMBER, is_active=True)
        db_session.add(m)
        await db_session.flush()
        users[str(org_id)] = u

    return users


class TestConversationIsolation:
    async def test_user_a_cannot_read_user_b_messages(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        users_in_two_orgs: dict,
    ):
        """
        SECURITY TEST: User A must receive 404 when requesting messages
        from a conversation owned by User B in Org B.
        """
        user_b = users_in_two_orgs[str(ORG_B)]

        # Create a conversation owned by user_b / org_b
        conv_b = Conversation(
            organization_id=ORG_B,
            user_id=user_b.id,
            title="Org B Private Conversation",
        )
        db_session.add(conv_b)
        await db_session.flush()

        # Log in as user_a in org_a
        login_res = await client.post("/api/v1/auth/login", json={
            "email": "user-a@example.com",
            "password": "UserPass1!",
            "organization_id": str(ORG_A),
        })
        assert login_res.status_code == 200

        # Attempt to read Org B's conversation messages
        res = await client.get(f"/api/v1/chat/conversations/{conv_b.id}/messages")
        assert res.status_code == 404, (
            f"SECURITY VIOLATION: User A read User B's conversation messages. "
            f"Status: {res.status_code}"
        )

    async def test_user_a_cannot_delete_user_b_conversation(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        users_in_two_orgs: dict,
    ):
        user_b = users_in_two_orgs[str(ORG_B)]
        conv_b = Conversation(
            organization_id=ORG_B,
            user_id=user_b.id,
            title="Org B Conversation 2",
        )
        db_session.add(conv_b)
        await db_session.flush()

        await client.post("/api/v1/auth/login", json={
            "email": "user-a@example.com",
            "password": "UserPass1!",
            "organization_id": str(ORG_A),
        })

        res = await client.delete(f"/api/v1/chat/conversations/{conv_b.id}")
        assert res.status_code == 404, (
            f"SECURITY VIOLATION: User A deleted User B's conversation. "
            f"Status: {res.status_code}"
        )

    async def test_conversation_list_scoped_to_own_user_and_org(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        users_in_two_orgs: dict,
    ):
        user_a = users_in_two_orgs[str(ORG_A)]
        user_b = users_in_two_orgs[str(ORG_B)]

        conv_a = Conversation(organization_id=ORG_A, user_id=user_a.id, title="User A Conv")
        conv_b = Conversation(organization_id=ORG_B, user_id=user_b.id, title="User B Conv")
        db_session.add(conv_a)
        db_session.add(conv_b)
        await db_session.flush()

        await client.post("/api/v1/auth/login", json={
            "email": "user-a@example.com",
            "password": "UserPass1!",
            "organization_id": str(ORG_A),
        })

        res = await client.get("/api/v1/chat/conversations")
        assert res.status_code == 200
        payload = res.json()
        titles = [
            c["title"] for c in (payload["items"] if isinstance(payload, dict) else payload)
        ]
        assert "User A Conv" in titles
        assert "User B Conv" not in titles, (
            "SECURITY VIOLATION: User A can see User B's conversation in list"
        )
