"""End-to-end test for streamed-answer persistence and analytics.

A fake ``RAGService`` yields a short answer and sets ``last_stream_result`` so
the route can persist the question, answer, citations, token counts, latency,
and a linked ``UsageRecord``. The test then verifies:

- the stream ends with a ``meta`` event carrying the real message IDs;
- the persisted rows are visible through personal analytics;
- the admin question explorer shows the answer, flow, and source details;
- token usage is recorded in ``usage_records``.

Requires PostgreSQL (``TEST_DATABASE_URL``) because models use
``UUID``/``JSONB``/``Vector`` columns.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_groq
from app.core.security import hash_password
from app.db.models.audit import UsageRecord
from app.db.models.conversation import Conversation, Message, MessageRole
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import OrganizationMembership, OrgRole, User, UserStatus
from app.main import app as fastapi_app
from app.services.rag_service import Citation, RAGResult

ORG_ID = uuid.UUID("ffffffff-0000-0000-0000-000000000001")
PASSWORD = "TestPass1!"
DOCUMENT_ID = str(uuid.uuid4())


class _FakeRAGService:
    """Stand-in for RAGService that streams a fixed, cited answer."""

    def __init__(self, db: AsyncSession, groq: object) -> None:
        self.last_stream_result: RAGResult | None = None

    async def answer_stream(
        self,
        *,
        question: str,
        conversation_id: uuid.UUID,
        user_id: uuid.UUID,
        organization_id: uuid.UUID,
    ) -> AsyncGenerator[str, None]:
        yield "Leave requests "
        yield "need two weeks of notice."
        self.last_stream_result = RAGResult(
            answer="Leave requests need two weeks of notice.",
            citations=[
                Citation(
                    source_number=1,
                    document_id=DOCUMENT_ID,
                    document_title="Leave Policy",
                    page_number=2,
                    section_heading="Leave policy",
                    excerpt="File leave two weeks ahead.",
                    chunk_id=str(uuid.uuid4()),
                    retrieval_method="hybrid",
                    similarity=0.91,
                )
            ],
            model_used="llama-test",
            input_tokens=120,
            output_tokens=40,
            latency_ms=800,
            retrieval_latency_ms=25,
            retrieved_count=1,
        )


async def _login(client: AsyncClient, email: str) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD, "organization_id": str(ORG_ID)},
    )
    assert res.status_code == 200, res.text


@pytest.fixture
async def admin_user(db_session: AsyncSession) -> User:
    org = Organization(
        id=ORG_ID,
        name="Streaming Org",
        slug="streaming-org",
        status=OrganizationStatus.ACTIVE,
    )
    db_session.add(org)
    user = User(
        email="streaming-admin@example.com",
        email_normalized="streaming-admin@example.com",
        hashed_password=hash_password(PASSWORD),
        full_name="Streaming Admin",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            user_id=user.id,
            organization_id=ORG_ID,
            role=OrgRole.ORG_ADMIN,
        )
    )
    await db_session.flush()
    return user


async def _stream_answer(
    client: AsyncClient, conversation_id: str, question: str
) -> dict:
    """Run the streaming endpoint and return the parsed ``meta`` payload."""
    res = await client.post(
        "/api/v1/chat/ask/stream",
        json={"question": question, "conversation_id": conversation_id},
    )
    assert res.status_code == 200, res.text
    assert "data: [DONE]" in res.text

    meta: dict | None = None
    for line in res.text.splitlines():
        if not line.startswith("data: "):
            continue
        body = line[len("data: ") :]
        if body == "[DONE]":
            continue
        payload = json.loads(body)
        if "meta" in payload:
            meta = payload["meta"]
    assert meta is not None, res.text
    return meta


async def test_stream_persists_citations_and_usage(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
) -> None:
    await _login(client, admin_user.email)
    fastapi_app.dependency_overrides[get_groq] = lambda: object()

    try:
        created = await client.post(
            "/api/v1/chat/conversations", json={"title": "Streaming test"}
        )
        assert created.status_code == 201, created.text
        conversation_id = created.json()["id"]

        with patch("app.api.v1.chat.RAGService", _FakeRAGService):
            meta = await _stream_answer(
                client, conversation_id, "How much notice do I need for leave?"
            )

        # The final event exposes real message IDs so the client can attach
        # citations and submit feedback without reloading the conversation.
        uuid.UUID(meta["user_message_id"])
        uuid.UUID(meta["assistant_message_id"])
        assert meta["model_used"] == "llama-test"
        assert len(meta["citations"]) == 1
        assert meta["citations"][0]["retrieval_method"] == "hybrid"
        assert meta["citations"][0]["similarity"] == pytest.approx(0.91)

        db_session.expire_all()
        answer = await db_session.get(Message, uuid.UUID(meta["assistant_message_id"]))
        assert answer is not None
        assert answer.role == MessageRole.ASSISTANT
        assert answer.content == "Leave requests need two weeks of notice."
        assert answer.input_tokens == 120
        assert answer.output_tokens == 40
        assert answer.latency_ms == 800
        assert answer.citations is not None
        assert answer.citations[0]["document_title"] == "Leave Policy"

        question = await db_session.get(Message, uuid.UUID(meta["user_message_id"]))
        assert question is not None
        assert question.role == MessageRole.USER

        usage = await db_session.scalar(
            select(UsageRecord).where(
                UsageRecord.message_id == answer.id,
                UsageRecord.organization_id == ORG_ID,
            )
        )
        assert usage is not None
        assert usage.total_tokens == 160
        assert usage.request_latency_ms == 800

        conversation = await db_session.get(
            Conversation, uuid.UUID(conversation_id)
        )
        assert conversation is not None
        assert conversation.message_count == 2

        # Personal analytics pick up the persisted streamed answer.
        personal = await client.get("/api/v1/analytics/me")
        assert personal.status_code == 200, personal.text
        summary = personal.json()["summary"]
        assert summary["total_questions"] == 1
        assert summary["total_conversations"] == 1
        assert summary["total_tokens"] == 160
        assert summary["avg_latency_ms"] == 800
        recent = personal.json()["recent_questions"]
        assert len(recent) == 1
        assert recent[0]["answer"] == "Leave requests need two weeks of notice."
        assert recent[0]["sources"][0]["document_title"] == "Leave Policy"

        # Admin drill-down shows the flow and enriched source provenance.
        detail = await client.get(
            f"/api/v1/admin/questions/{meta['user_message_id']}"
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["answer"] == "Leave requests need two weeks of notice."
        assert body["latency_ms"] == 800
        assert body["sources"][0]["retrieval_method"] == "hybrid"
        assert body["sources"][0]["similarity"] == pytest.approx(0.91)
        assert [step["stage"] for step in body["flow"]] == [
            "question",
            "retrieval",
            "generation",
            "feedback",
        ]
    finally:
        fastapi_app.dependency_overrides.pop(get_groq, None)
