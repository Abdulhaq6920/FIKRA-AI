"""Integration tests for analytics and admin drill-down endpoints.

Covers:
- personal analytics are scoped to the signed-in user only;
- org analytics list every membership (including inactive) for admins;
- per-user drill-down is tenant-scoped and 404s across tenants;
- question explorer returns answer, flow, and enriched sources;
- document explorer returns jobs/chunks and citation counts;
- non-admin callers are forbidden from admin insights.

Requires PostgreSQL (``TEST_DATABASE_URL``) because models use
``UUID``/``JSONB``/``Vector`` columns.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.conversation import (
    Conversation,
    Feedback,
    FeedbackType,
    Message,
    MessageRole,
)
from app.db.models.document import (
    Document,
    DocumentChunk,
    DocumentProcessingJob,
    DocumentStatus,
    JobStatus,
)
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import OrganizationMembership, OrgRole, User, UserStatus

ORG_ID = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
OTHER_ORG_ID = uuid.UUID("eeeeeeee-0000-0000-0000-000000000002")

PASSWORD = "TestPass1!"


# ─── Helpers ──────────────────────────────────────────────────────────────


async def _make_user(
    db: AsyncSession,
    org_id: uuid.UUID,
    *,
    email: str,
    full_name: str,
    role: OrgRole = OrgRole.MEMBER,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        email_normalized=email.lower(),
        hashed_password=hash_password(PASSWORD),
        full_name=full_name,
        status=UserStatus.ACTIVE,
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


async def _make_conversation(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, title: str
) -> Conversation:
    conversation = Conversation(
        organization_id=org_id,
        user_id=user_id,
        title=title,
        message_count=2,
    )
    db.add(conversation)
    await db.flush()
    return conversation


async def _make_turn(
    db: AsyncSession,
    conversation: Conversation,
    user_id: uuid.UUID,
    *,
    question: str,
    answer: str,
    citations: list[dict] | None = None,
    asked_at: datetime | None = None,
) -> tuple[Message, Message]:
    asked_at = asked_at or datetime.now(timezone.utc)
    user_message = Message(
        conversation_id=conversation.id,
        organization_id=conversation.organization_id,
        user_id=user_id,
        role=MessageRole.USER,
        content=question,
        created_at=asked_at,
    )
    db.add(user_message)
    await db.flush()
    assistant_message = Message(
        conversation_id=conversation.id,
        organization_id=conversation.organization_id,
        user_id=user_id,
        role=MessageRole.ASSISTANT,
        content=answer,
        model_used="llama-test",
        input_tokens=100,
        output_tokens=50,
        latency_ms=420,
        citations=citations,
        created_at=asked_at + timedelta(seconds=2),
    )
    db.add(assistant_message)
    await db.flush()
    return user_message, assistant_message


async def _make_document(
    db: AsyncSession,
    org_id: uuid.UUID,
    uploaded_by: uuid.UUID,
    *,
    title: str = "Policy Handbook",
    filename: str = "handbook.pdf",
) -> Document:
    document = Document(
        organization_id=org_id,
        uploaded_by=uploaded_by,
        title=title,
        original_filename=filename,
        storage_path=f"uploads/{org_id}/{uuid.uuid4()}-{filename}",
        mime_type="application/pdf",
        file_extension="pdf",
        file_size_bytes=2048,
        checksum_sha256="a" * 64,
        status=DocumentStatus.READY,
        page_count=4,
        word_count=900,
        chunk_count=1,
    )
    db.add(document)
    await db.flush()
    db.add(
        DocumentChunk(
            document_id=document.id,
            organization_id=org_id,
            content="Leave requests must be filed two weeks in advance.",
            content_hash="b" * 64,
            chunk_index=0,
            page_number=2,
            section_heading="Leave policy",
            token_count=12,
        )
    )
    db.add(
        DocumentProcessingJob(
            document_id=document.id,
            organization_id=org_id,
            status=JobStatus.SUCCESS,
            attempt_number=1,
        )
    )
    await db.flush()
    return document


async def _login(client: AsyncClient, email: str, org_id: uuid.UUID = ORG_ID) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": PASSWORD,
            "organization_id": str(org_id),
        },
    )
    assert res.status_code == 200, res.text


# ─── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
async def test_org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=ORG_ID,
        name="Analytics Org",
        slug="analytics-org",
        status=OrganizationStatus.ACTIVE,
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def other_org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=OTHER_ORG_ID,
        name="Other Analytics Org",
        slug="other-analytics-org",
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
        email="analytics-admin@example.com",
        full_name="Analytics Admin",
        role=OrgRole.ORG_ADMIN,
    )


@pytest.fixture
async def member_user(db_session: AsyncSession, test_org: Organization) -> User:
    return await _make_user(
        db_session,
        ORG_ID,
        email="analytics-member@example.com",
        full_name="Analytics Member",
    )


@pytest.fixture
async def other_tenant_user(db_session: AsyncSession, other_org: Organization) -> User:
    return await _make_user(
        db_session,
        OTHER_ORG_ID,
        email="analytics-other@example.com",
        full_name="Other Tenant User",
    )


# ─── Personal analytics ───────────────────────────────────────────────────


class TestPersonalAnalytics:
    async def test_only_returns_callers_own_activity(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        own_conversation = await _make_conversation(
            db_session, ORG_ID, member_user.id, "My questions"
        )
        question, answer = await _make_turn(
            db_session,
            own_conversation,
            member_user.id,
            question="How many leave days do I get?",
            answer="You get 20 days.",
        )
        db_session.add(
            Feedback(
                message_id=answer.id,
                user_id=member_user.id,
                organization_id=ORG_ID,
                feedback_type=FeedbackType.THUMBS_UP,
            )
        )

        admin_conversation = await _make_conversation(
            db_session, ORG_ID, admin_user.id, "Admin questions"
        )
        await _make_turn(
            db_session,
            admin_conversation,
            admin_user.id,
            question="What is the expense policy?",
            answer="Submit receipts within 30 days.",
        )
        await db_session.flush()

        await _login(client, member_user.email)
        res = await client.get("/api/v1/analytics/me")
        assert res.status_code == 200, res.text
        data = res.json()

        summary = data["summary"]
        assert summary["total_questions"] == 1
        assert summary["total_conversations"] == 1
        assert summary["total_tokens"] == 150
        assert summary["avg_latency_ms"] == 420
        # Admin-only fields are not populated for personal analytics.
        assert summary["total_users"] is None

        assert len(data["recent_questions"]) == 1
        assert data["recent_questions"][0]["id"] == str(question.id)
        assert data["recent_questions"][0]["answer"] == "You get 20 days."
        assert data["recent_questions"][0]["feedback"][0]["feedback_type"] == "thumbs_up"

    async def test_new_user_without_activity_gets_zeroed_analytics(
        self, client: AsyncClient, member_user: User
    ):
        await _login(client, member_user.email)
        res = await client.get("/api/v1/analytics/me")
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["summary"]["total_questions"] == 0
        assert data["summary"]["total_tokens"] == 0
        assert data["recent_questions"] == []
        assert len(data["daily"]) == 14


# ─── Organization analytics ───────────────────────────────────────────────


class TestOrgAnalytics:
    async def test_lists_users_including_inactive(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        inactive = await _make_user(
            db_session,
            ORG_ID,
            email="analytics-inactive@example.com",
            full_name="Inactive Person",
            is_active=False,
        )
        conversation = await _make_conversation(
            db_session, ORG_ID, member_user.id, "Member conversation"
        )
        await _make_turn(
            db_session,
            conversation,
            member_user.id,
            question="A member question",
            answer="A member answer",
        )
        await db_session.flush()

        await _login(client, admin_user.email)
        res = await client.get("/api/v1/admin/analytics")
        assert res.status_code == 200, res.text
        data = res.json()

        assert data["summary"]["total_users"] == 3
        assert data["summary"]["active_users"] == 2
        assert data["summary"]["total_questions"] == 1

        emails = {row["email"] for row in data["users"]["items"]}
        assert emails == {admin_user.email, member_user.email, inactive.email}
        member_row = next(
            row for row in data["users"]["items"] if row["email"] == member_user.email
        )
        assert member_row["questions"] == 1
        assert member_row["tokens"] == 150
        assert member_row["role"] == "member"
        inactive_row = next(
            row for row in data["users"]["items"] if row["email"] == inactive.email
        )
        assert inactive_row["is_active"] is False

    async def test_search_and_pagination(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        await _make_user(
            db_session,
            ORG_ID,
            email="someone-else@example.com",
            full_name="Someone Else",
        )
        await db_session.flush()
        await _login(client, admin_user.email)

        res = await client.get(
            "/api/v1/admin/analytics", params={"search": "analytics-member"}
        )
        assert res.status_code == 200, res.text
        assert [row["email"] for row in res.json()["users"]["items"]] == [
            member_user.email
        ]

        res = await client.get(
            "/api/v1/admin/analytics", params={"page": 1, "page_size": 2}
        )
        assert res.status_code == 200
        data = res.json()
        assert len(data["users"]["items"]) == 2
        assert data["users"]["total"] == 3

    async def test_member_is_forbidden(
        self, client: AsyncClient, member_user: User
    ):
        await _login(client, member_user.email)
        res = await client.get("/api/v1/admin/analytics")
        assert res.status_code == 403

    async def test_per_user_detail_is_scoped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        conversation = await _make_conversation(
            db_session, ORG_ID, member_user.id, "Detail conversation"
        )
        question, answer = await _make_turn(
            db_session,
            conversation,
            member_user.id,
            question="Detail question",
            answer="Detail answer",
        )
        db_session.add(
            Feedback(
                message_id=answer.id,
                user_id=member_user.id,
                organization_id=ORG_ID,
                feedback_type=FeedbackType.MISSING_INFO,
                comment="Needs more detail",
            )
        )
        await db_session.flush()

        await _login(client, admin_user.email)
        res = await client.get(f"/api/v1/admin/analytics/users/{member_user.id}")
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["user"]["email"] == member_user.email
        assert data["summary"]["total_questions"] == 1
        assert data["summary"]["total_tokens"] == 150
        assert data["recent_questions"][0]["id"] == str(question.id)
        assert data["recent_questions"][0]["feedback"][0]["comment"] == (
            "Needs more detail"
        )

    async def test_per_user_detail_cross_tenant_returns_404(
        self,
        client: AsyncClient,
        other_tenant_user: User,
        admin_user: User,
    ):
        await _login(client, admin_user.email)
        res = await client.get(
            f"/api/v1/admin/analytics/users/{other_tenant_user.id}"
        )
        assert res.status_code == 404


# ─── Question explorer ────────────────────────────────────────────────────


class TestQuestionExplorer:
    async def test_list_and_detail_include_flow_and_sources(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        document = await _make_document(
            db_session, ORG_ID, admin_user.id, title="Leave Policy"
        )
        chunk = await db_session.scalar(
            select(DocumentChunk).where(
                DocumentChunk.document_id == document.id
            )
        )
        conversation = await _make_conversation(
            db_session, ORG_ID, member_user.id, "Policy questions"
        )
        question, answer = await _make_turn(
            db_session,
            conversation,
            member_user.id,
            question="How do I request leave?",
            answer="File the request two weeks ahead.",
            citations=[
                {
                    "source_number": 1,
                    "document_id": str(document.id),
                    "document_title": "Leave Policy",
                    "page_number": 2,
                    "section_heading": "Leave policy",
                    "excerpt": "File two weeks ahead.",
                    "chunk_id": str(chunk.id),
                    "retrieval_method": "hybrid",
                    "similarity": 0.87,
                }
            ],
        )
        db_session.add(
            Feedback(
                message_id=answer.id,
                user_id=member_user.id,
                organization_id=ORG_ID,
                feedback_type=FeedbackType.THUMBS_UP,
            )
        )
        await db_session.flush()

        await _login(client, admin_user.email)

        res = await client.get("/api/v1/admin/questions")
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["total"] == 1
        item = data["items"][0]
        assert item["id"] == str(question.id)
        assert item["user_email"] == member_user.email
        assert item["answer_excerpt"].startswith("File the request")
        assert item["citation_count"] == 1
        assert item["feedback_count"] == 1
        assert item["input_tokens"] == 100

        res = await client.get(f"/api/v1/admin/questions/{question.id}")
        assert res.status_code == 200, res.text
        detail = res.json()
        assert detail["answer"] == "File the request two weeks ahead."
        assert detail["latency_ms"] == 420
        assert detail["sources"][0]["similarity"] == 0.87
        assert detail["sources"][0]["retrieval_method"] == "hybrid"
        assert detail["sources"][0]["document_original_filename"] == "handbook.pdf"
        assert detail["sources"][0]["chunk_content"].startswith("Leave requests")
        stages = [step["stage"] for step in detail["flow"]]
        assert stages == ["question", "retrieval", "generation", "feedback"]
        assert detail["feedback"][0]["feedback_type"] == "thumbs_up"

    async def test_search_matches_question_text(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        conversation = await _make_conversation(
            db_session, ORG_ID, member_user.id, "Search conversation"
        )
        await _make_turn(
            db_session,
            conversation,
            member_user.id,
            question="What is the travel reimbursement limit?",
            answer="It is 500 USD.",
        )
        await db_session.flush()

        await _login(client, admin_user.email)
        res = await client.get(
            "/api/v1/admin/questions", params={"search": "reimbursement"}
        )
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 1

        res = await client.get(
            "/api/v1/admin/questions", params={"search": "no-such-term"}
        )
        assert res.status_code == 200
        assert res.json()["total"] == 0

    async def test_cross_tenant_question_returns_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        other_tenant_user: User,
    ):
        other_conversation = await _make_conversation(
            db_session, OTHER_ORG_ID, other_tenant_user.id, "Other conversation"
        )
        other_question, _ = await _make_turn(
            db_session,
            other_conversation,
            other_tenant_user.id,
            question="Other tenant question",
            answer="Other tenant answer",
        )
        await db_session.flush()

        await _login(client, admin_user.email)
        res = await client.get(f"/api/v1/admin/questions/{other_question.id}")
        assert res.status_code == 404

        res = await client.get("/api/v1/admin/questions")
        assert res.status_code == 200
        assert res.json()["total"] == 0

    async def test_member_is_forbidden(
        self, client: AsyncClient, member_user: User
    ):
        await _login(client, member_user.email)
        assert (await client.get("/api/v1/admin/questions")).status_code == 403
        assert (
            await client.get(f"/api/v1/admin/questions/{uuid.uuid4()}")
        ).status_code == 403


# ─── Document explorer ────────────────────────────────────────────────────


class TestDocumentExplorer:
    async def test_list_and_detail(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        member_user: User,
    ):
        document = await _make_document(db_session, ORG_ID, admin_user.id)
        conversation = await _make_conversation(
            db_session, ORG_ID, member_user.id, "Doc questions"
        )
        await _make_turn(
            db_session,
            conversation,
            member_user.id,
            question="Which document covers leave?",
            answer="The policy handbook.",
            citations=[
                {
                    "source_number": 1,
                    "document_id": str(document.id),
                    "document_title": document.title,
                    "page_number": 2,
                    "section_heading": "Leave policy",
                    "excerpt": "Leave requests must be filed two weeks in advance.",
                }
            ],
        )
        await db_session.flush()

        await _login(client, admin_user.email)
        res = await client.get("/api/v1/admin/documents")
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["total"] == 1
        item = data["items"][0]
        assert item["id"] == str(document.id)
        assert item["uploaded_by_email"] == admin_user.email
        assert item["citation_count"] == 1
        assert item["chunk_count"] == 1

        res = await client.get(f"/api/v1/admin/documents/{document.id}")
        assert res.status_code == 200, res.text
        detail = res.json()
        assert detail["checksum_sha256"] == "a" * 64
        assert detail["jobs"][0]["status"] == "success"
        assert detail["chunks"][0]["chunk_index"] == 0
        assert detail["chunks"][0]["excerpt"].startswith("Leave requests")

    async def test_cross_tenant_document_returns_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        other_tenant_user: User,
    ):
        other_document = await _make_document(
            db_session, OTHER_ORG_ID, other_tenant_user.id, title="Other doc"
        )
        await db_session.flush()

        await _login(client, admin_user.email)
        res = await client.get(f"/api/v1/admin/documents/{other_document.id}")
        assert res.status_code == 404

        res = await client.get("/api/v1/admin/documents")
        assert res.status_code == 200
        assert res.json()["total"] == 0

    async def test_member_is_forbidden(
        self, client: AsyncClient, member_user: User
    ):
        await _login(client, member_user.email)
        assert (await client.get("/api/v1/admin/documents")).status_code == 403
        assert (
            await client.get(f"/api/v1/admin/documents/{uuid.uuid4()}")
        ).status_code == 403
