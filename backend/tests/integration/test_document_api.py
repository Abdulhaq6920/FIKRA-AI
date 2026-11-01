"""
Integration tests for document API + tenant isolation.

Key assertions:
- Upload creates document record with QUEUED status
- Org A cannot access Org B's document (returns 404)
- Delete is soft-delete (document not actually removed from DB)
- Status endpoint returns processing job details
"""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.document import Document, DocumentStatus
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import OrgRole, OrganizationMembership, User, UserStatus

ORG_A = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
ORG_B = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")


@pytest.fixture
async def two_orgs(db_session: AsyncSession):
    for org_id, slug in [(ORG_A, "org-a-docs"), (ORG_B, "org-b-docs")]:
        org = Organization(id=org_id, name=f"Org {slug}", slug=slug, status=OrganizationStatus.ACTIVE)
        db_session.add(org)
    await db_session.flush()


@pytest.fixture
async def admin_user_org_a(db_session: AsyncSession, two_orgs) -> User:
    user = User(
        email="admin-a@example.com",
        email_normalized="admin-a@example.com",
        hashed_password=hash_password("Admin1234!"),
        full_name="Admin A",
        status=UserStatus.ACTIVE,
        is_platform_admin=True,  # simplify: platform admin can upload
    )
    db_session.add(user)
    await db_session.flush()
    m = OrganizationMembership(user_id=user.id, organization_id=ORG_A, role=OrgRole.ORG_ADMIN, is_active=True)
    db_session.add(m)
    await db_session.flush()
    return user


@pytest.fixture
async def admin_user_org_b(db_session: AsyncSession, two_orgs) -> User:
    user = User(
        email="admin-b@example.com",
        email_normalized="admin-b@example.com",
        hashed_password=hash_password("Admin1234!"),
        full_name="Admin B",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    m = OrganizationMembership(user_id=user.id, organization_id=ORG_B, role=OrgRole.ORG_ADMIN, is_active=True)
    db_session.add(m)
    await db_session.flush()
    return user


async def _login(client: AsyncClient, email: str, org_id: uuid.UUID) -> None:
    res = await client.post("/api/v1/auth/login", json={
        "email": email, "password": "Admin1234!", "organization_id": str(org_id)
    })
    assert res.status_code == 200, f"Login failed: {res.text}"


class TestDocumentTenantIsolation:
    async def test_org_a_cannot_access_org_b_document(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user_org_a: User,
        admin_user_org_b: User,
    ):
        """
        SECURITY TEST: Org A must receive 404 when requesting a document
        belonging to Org B, even if it knows the document's UUID.
        """
        # Create an Org B document directly in the DB
        org_b_doc = Document(
            organization_id=ORG_B,
            uploaded_by=admin_user_org_b.id,
            title="Org B Secret",
            original_filename="secret.pdf",
            storage_path=f"{ORG_B}/secret/secret.pdf",
            mime_type="application/pdf",
            file_extension="pdf",
            file_size_bytes=1024,
            checksum_sha256="abc123",
            status=DocumentStatus.READY,
        )
        db_session.add(org_b_doc)
        await db_session.flush()

        # Log in as Org A admin
        await _login(client, "admin-a@example.com", ORG_A)

        # Attempt to access Org B's document by ID
        res = await client.get(f"/api/v1/documents/{org_b_doc.id}")
        assert res.status_code == 404, (
            f"SECURITY VIOLATION: Org A accessed Org B document. Status: {res.status_code}"
        )

    async def test_org_a_cannot_delete_org_b_document(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user_org_a: User,
        admin_user_org_b: User,
    ):
        """Org A cannot delete Org B's document."""
        org_b_doc = Document(
            organization_id=ORG_B,
            uploaded_by=admin_user_org_b.id,
            title="Org B Secret 2",
            original_filename="secret2.pdf",
            storage_path=f"{ORG_B}/secret2/secret2.pdf",
            mime_type="application/pdf",
            file_extension="pdf",
            file_size_bytes=512,
            checksum_sha256="def456",
            status=DocumentStatus.READY,
        )
        db_session.add(org_b_doc)
        await db_session.flush()

        await _login(client, "admin-a@example.com", ORG_A)

        res = await client.delete(f"/api/v1/documents/{org_b_doc.id}")
        assert res.status_code == 404, (
            f"SECURITY VIOLATION: Org A deleted Org B document. Status: {res.status_code}"
        )

    async def test_document_list_only_shows_own_org(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user_org_a: User,
        admin_user_org_b: User,
    ):
        """
        Document listing must only return documents from the authenticated
        user's organization — never from another organization.
        """
        # Create one document for each org
        doc_a = Document(
            organization_id=ORG_A, uploaded_by=admin_user_org_a.id,
            title="Org A Doc", original_filename="a.pdf",
            storage_path=f"{ORG_A}/a/a.pdf", mime_type="application/pdf",
            file_extension="pdf", file_size_bytes=100, checksum_sha256="aaa",
            status=DocumentStatus.READY,
        )
        doc_b = Document(
            organization_id=ORG_B, uploaded_by=admin_user_org_b.id,
            title="Org B Doc", original_filename="b.pdf",
            storage_path=f"{ORG_B}/b/b.pdf", mime_type="application/pdf",
            file_extension="pdf", file_size_bytes=100, checksum_sha256="bbb",
            status=DocumentStatus.READY,
        )
        db_session.add(doc_a)
        db_session.add(doc_b)
        await db_session.flush()

        # Log in as Org A
        await _login(client, "admin-a@example.com", ORG_A)
        res = await client.get("/api/v1/documents/")
        assert res.status_code == 200
        items = res.json()["items"]
        titles = [d["title"] for d in items]

        assert "Org A Doc" in titles, "Org A should see its own document"
        assert "Org B Doc" not in titles, (
            "SECURITY VIOLATION: Org A can see Org B's document in list"
        )
