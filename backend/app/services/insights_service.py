"""Shared analytics and drill-down queries.

Everything here is tenant-scoped: callers pass the organization ID from the
signed JWT and every statement filters on it. Personal analytics additionally
filters on the authenticated user ID.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Text, and_, case, cast, desc, exists, func, or_, select, text, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.core.exceptions import NotFoundError
from app.db.models.audit import UsageRecord
from app.db.models.conversation import (
    Conversation,
    Feedback,
    FeedbackType,
    Message,
    MessageRole,
)
from app.db.models.document import Document, DocumentChunk, DocumentProcessingJob
from app.db.models.user import OrganizationMembership, OrgRole, User
from app.schemas.analytics import (
    AdminDocumentDetailOut,
    AdminDocumentRow,
    AnalyticsSummary,
    CitationSourceOut,
    DailyPoint,
    DocumentChunkPreview,
    DocumentJobOut,
    FlowStep,
    QuestionDetailOut,
    QuestionFeedbackOut,
    QuestionListItem,
    RecentQuestion,
    SourceStat,
    UserAnalyticsListResponse,
    UserAnalyticsRow,
)

# ─── Small helpers ────────────────────────────────────────────────────────


def _api_role(user: User, membership: OrganizationMembership) -> str:
    if user.is_platform_admin or membership.role == OrgRole.ORG_ADMIN:
        return "admin"
    return "member"


def _int(value: Any) -> int:
    return int(value or 0)


def _float(value: Any) -> float | None:
    return float(value) if value is not None else None


def _feedback_type(value: FeedbackType | str) -> str:
    return value.value if isinstance(value, FeedbackType) else str(value)


def _citation_elements() -> Any:
    """Lateral table-valued alias over ``messages.citations``.

    The column is JSONB and may hold a JSON ``null`` (SQLAlchemy serializes
    Python ``None`` that way by default), so guard with ``jsonb_typeof`` and
    substitute an empty array — otherwise ``jsonb_array_elements`` raises
    "cannot extract elements from a scalar".
    """
    safe_array = case(
        (func.jsonb_typeof(Message.citations) == "array", Message.citations),
        else_=text("'[]'::jsonb"),
    )
    return (
        func.jsonb_array_elements(safe_array)
        .table_valued("value")
        .alias("citation")
    )


# ─── Summary / activity ───────────────────────────────────────────────────


def _cost_usd(input_tokens: int, output_tokens: int) -> float:
    """Estimate provider spend in USD from token counts.

    Rates are configured per million tokens so the estimate follows whichever
    Groq model is deployed. The frontend converts the USD value into the
    currency selected by the user (USD or INR).
    """
    return round(
        (input_tokens / 1_000_000) * settings.groq_input_cost_per_million_usd
        + (output_tokens / 1_000_000) * settings.groq_output_cost_per_million_usd,
        6,
    )


async def build_summary(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    include_admin: bool = False,
) -> AnalyticsSummary:
    """Aggregate question, conversation, token, and latency metrics."""
    msg_filters = [Message.organization_id == organization_id]
    conv_filters = [
        Conversation.organization_id == organization_id,
        Conversation.is_active == True,  # noqa: E712
    ]
    if user_id is not None:
        msg_filters.append(Message.user_id == user_id)
        conv_filters.append(Conversation.user_id == user_id)

    total_questions = _int(
        await db.scalar(
            select(func.count(Message.id)).where(
                *msg_filters, Message.role == MessageRole.USER
            )
        )
    )
    total_conversations = _int(
        await db.scalar(select(func.count(Conversation.id)).where(*conv_filters))
    )
    total_input_tokens = _int(
        await db.scalar(
            select(func.coalesce(func.sum(Message.input_tokens), 0)).where(
                *msg_filters, Message.role == MessageRole.ASSISTANT
            )
        )
    )
    total_output_tokens = _int(
        await db.scalar(
            select(func.coalesce(func.sum(Message.output_tokens), 0)).where(
                *msg_filters, Message.role == MessageRole.ASSISTANT
            )
        )
    )
    total_tokens = total_input_tokens + total_output_tokens
    avg_latency = await db.scalar(
        select(func.avg(Message.latency_ms)).where(
            *msg_filters,
            Message.role == MessageRole.ASSISTANT,
            Message.latency_ms.is_not(None),
        )
    )

    summary = AnalyticsSummary(
        total_questions=total_questions,
        total_conversations=total_conversations,
        total_tokens=total_tokens,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_cost_usd=_cost_usd(total_input_tokens, total_output_tokens),
        avg_latency_ms=_float(avg_latency),
    )

    if include_admin:
        summary.total_users = _int(
            await db.scalar(
                select(func.count(OrganizationMembership.id)).where(
                    OrganizationMembership.organization_id == organization_id
                )
            )
        )
        summary.active_users = _int(
            await db.scalar(
                select(func.count(OrganizationMembership.id)).where(
                    OrganizationMembership.organization_id == organization_id,
                    OrganizationMembership.is_active == True,  # noqa: E712
                )
            )
        )
        summary.total_documents = _int(
            await db.scalar(
                select(func.count(Document.id)).where(
                    Document.organization_id == organization_id,
                    Document.is_active == True,  # noqa: E712
                )
            )
        )

    # Feedback is meaningful both per member and per organization: the personal
    # analytics page shows the caller's own rating counts, while the admin view
    # shows organization-wide totals.
    feedback_filters: list[Any] = [Feedback.organization_id == organization_id]
    if user_id is not None:
        feedback_filters.append(Feedback.user_id == user_id)
    counts = {
        _feedback_type(row[0]): int(row[1])
        for row in (
            await db.execute(
                select(Feedback.feedback_type, func.count(Feedback.id))
                .where(*feedback_filters)
                .group_by(Feedback.feedback_type)
            )
        ).all()
    }
    positive = counts.get(FeedbackType.THUMBS_UP.value, 0)
    total_feedback = sum(counts.values())
    summary.total_feedback = total_feedback
    summary.positive_feedback = positive
    summary.negative_feedback = total_feedback - positive
    return summary


async def daily_activity(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    days: int = 14,
) -> list[DailyPoint]:
    """Questions asked and tokens consumed per day, zero-filled."""
    end = datetime.now(timezone.utc)
    start = (end - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    filters = [
        Message.organization_id == organization_id,
        Message.created_at >= start,
    ]
    if user_id is not None:
        filters.append(Message.user_id == user_id)

    day_expr = func.date_trunc("day", Message.created_at)
    question_rows = (
        await db.execute(
            select(day_expr, func.count(Message.id))
            .where(*filters, Message.role == MessageRole.USER)
            .group_by(day_expr)
        )
    ).all()
    token_rows = (
        await db.execute(
            select(
                day_expr,
                func.coalesce(func.sum(Message.input_tokens), 0),
                func.coalesce(func.sum(Message.output_tokens), 0),
            )
            .where(*filters, Message.role == MessageRole.ASSISTANT)
            .group_by(day_expr)
        )
    ).all()

    questions = {row[0].date(): int(row[1]) for row in question_rows}
    input_tokens = {row[0].date(): int(row[1]) for row in token_rows}
    output_tokens = {row[0].date(): int(row[2]) for row in token_rows}

    points: list[DailyPoint] = []
    for offset in range(days):
        day = start.date() + timedelta(days=offset)
        day_input = input_tokens.get(day, 0)
        day_output = output_tokens.get(day, 0)
        points.append(
            DailyPoint(
                date=day,
                questions=questions.get(day, 0),
                tokens=day_input + day_output,
                input_tokens=day_input,
                output_tokens=day_output,
                cost_usd=_cost_usd(day_input, day_output),
            )
        )
    return points


async def top_sources(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    limit: int = 8,
) -> list[SourceStat]:
    """Documents most often cited in assistant answers."""
    citation = _citation_elements()
    document_id = citation.c.value.op("->>")("document_id").label("document_id")
    document_title = citation.c.value.op("->>")("document_title").label(
        "document_title"
    )
    filters = [
        Message.organization_id == organization_id,
        Message.role == MessageRole.ASSISTANT,
        Message.citations.is_not(None),
    ]
    if user_id is not None:
        filters.append(Message.user_id == user_id)

    stmt = (
        select(document_id, document_title, func.count().label("citations"))
        .select_from(Message)
        .join(citation, true())
        .where(*filters)
        .group_by(document_id, document_title)
        .order_by(func.count().desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        SourceStat(
            document_id=row.document_id,
            document_title=row.document_title or "Unknown source",
            citations=int(row.citations),
        )
        for row in rows
    ]


# ─── Question explorer ────────────────────────────────────────────────────


def _question_select(
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    search: str | None = None,
) -> Any:
    """Build the tenant-scoped SELECT for (question, conversation, user, reply).

    The answer is the earliest assistant message posted after the question in
    the same conversation. Conditions are constructed per call so the tenant
    filter is always present — never cached in a module-level statement.
    """
    reply = aliased(Message)
    reply_id = (
        select(reply.id)
        .where(
            reply.conversation_id == Message.conversation_id,
            reply.organization_id == Message.organization_id,
            reply.role == MessageRole.ASSISTANT,
            reply.created_at >= Message.created_at,
        )
        .order_by(reply.created_at.asc(), reply.id.asc())
        .limit(1)
        .correlate(Message)
        .scalar_subquery()
    )
    feedback_count = (
        select(func.count(Feedback.id))
        .where(Feedback.message_id == reply.id)
        .correlate(reply)
        .scalar_subquery()
    )

    filters = [
        Message.organization_id == organization_id,
        Message.role == MessageRole.USER,
    ]
    if user_id is not None:
        filters.append(Message.user_id == user_id)
    if search:
        term = f"%{search.strip()}%"
        filters.append(
            or_(Message.content.ilike(term), Conversation.title.ilike(term))
        )

    return (
        select(
            Message,
            Conversation,
            User,
            reply,
            feedback_count.label("feedback_count"),
        )
        .join(Conversation, Conversation.id == Message.conversation_id)
        .join(User, User.id == Message.user_id)
        .outerjoin(reply, reply.id == reply_id)
        .where(*filters)
    )


async def _question_rows(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> list[Any]:
    stmt = (
        _question_select(organization_id, user_id=user_id, search=search)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return list((await db.execute(stmt)).all())


async def count_questions(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    search: str | None = None,
) -> int:
    filters = [
        Message.organization_id == organization_id,
        Message.role == MessageRole.USER,
    ]
    if user_id is not None:
        filters.append(Message.user_id == user_id)
    if search:
        term = f"%{search.strip()}%"
        filters.append(
            or_(Message.content.ilike(term), Conversation.title.ilike(term))
        )
    stmt = (
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(*filters)
    )
    return _int(await db.scalar(stmt))


def _question_item(row: Any) -> QuestionListItem:
    question, conversation, user, reply, feedback_count = row
    return QuestionListItem(
        id=question.id,
        user_id=user.id,
        user_name=user.full_name,
        user_email=user.email,
        conversation_id=conversation.id,
        conversation_title=conversation.title,
        question=question.content,
        answer_excerpt=(reply.content[:280] if reply is not None else None),
        asked_at=question.created_at,
        answered_at=reply.created_at if reply is not None else None,
        model_used=reply.model_used if reply is not None else None,
        input_tokens=_int(reply.input_tokens) if reply is not None else 0,
        output_tokens=_int(reply.output_tokens) if reply is not None else 0,
        cost_usd=(
            _cost_usd(_int(reply.input_tokens), _int(reply.output_tokens))
            if reply is not None
            else 0.0
        ),
        latency_ms=reply.latency_ms if reply is not None else None,
        citation_count=len(reply.citations or []) if reply is not None else 0,
        feedback_count=_int(feedback_count),
    )


async def list_questions(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[QuestionListItem], int]:
    rows = await _question_rows(
        db,
        organization_id,
        user_id=user_id,
        search=search,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    total = await count_questions(
        db, organization_id, user_id=user_id, search=search
    )
    return [_question_item(row) for row in rows], total


# ─── Source enrichment ────────────────────────────────────────────────────


async def _source_maps(
    db: AsyncSession,
    organization_id: uuid.UUID,
    citation_lists: list[list[dict[str, Any]]],
) -> tuple[dict[uuid.UUID, Document], dict[uuid.UUID, DocumentChunk]]:
    document_ids: set[uuid.UUID] = set()
    chunk_ids: set[uuid.UUID] = set()
    for citations in citation_lists:
        for citation in citations:
            doc_id = citation.get("document_id")
            chunk_id = citation.get("chunk_id")
            if doc_id:
                try:
                    document_ids.add(uuid.UUID(str(doc_id)))
                except ValueError:
                    pass
            if chunk_id:
                try:
                    chunk_ids.add(uuid.UUID(str(chunk_id)))
                except ValueError:
                    pass

    documents: dict[uuid.UUID, Document] = {}
    if document_ids:
        rows = await db.execute(
            select(Document).where(
                Document.organization_id == organization_id,
                Document.id.in_(document_ids),
            )
        )
        documents = {doc.id: doc for doc in rows.scalars().all()}

    chunks: dict[uuid.UUID, DocumentChunk] = {}
    if chunk_ids:
        rows = await db.execute(
            select(DocumentChunk).where(
                DocumentChunk.organization_id == organization_id,
                DocumentChunk.id.in_(chunk_ids),
            )
        )
        chunks = {chunk.id: chunk for chunk in rows.scalars().all()}

    return documents, chunks


def _build_source(
    citation: dict[str, Any],
    documents: dict[uuid.UUID, Document],
    chunks: dict[uuid.UUID, DocumentChunk],
) -> CitationSourceOut:
    document: Document | None = None
    doc_id = citation.get("document_id")
    if doc_id:
        try:
            document = documents.get(uuid.UUID(str(doc_id)))
        except ValueError:
            document = None

    chunk: DocumentChunk | None = None
    chunk_id = citation.get("chunk_id")
    if chunk_id:
        try:
            chunk = chunks.get(uuid.UUID(str(chunk_id)))
        except ValueError:
            chunk = None

    return CitationSourceOut(
        source_number=_int(citation.get("source_number")),
        document_id=doc_id,
        document_title=(
            citation.get("document_title")
            or (document.title if document is not None else "Unknown source")
        ),
        page_number=citation.get("page_number"),
        section_heading=citation.get("section_heading"),
        excerpt=citation.get("excerpt") or "",
        chunk_id=chunk_id,
        retrieval_method=citation.get("retrieval_method"),
        similarity=(
            float(citation["similarity"])
            if citation.get("similarity") is not None
            else None
        ),
        document_original_filename=(
            document.original_filename if document is not None else None
        ),
        document_mime_type=document.mime_type if document is not None else None,
        document_status=(
            document.status.value if document is not None else None
        ),
        chunk_content=chunk.content if chunk is not None else None,
        chunk_token_count=chunk.token_count if chunk is not None else None,
    )


def _build_sources(
    citations: list[dict[str, Any]],
    documents: dict[uuid.UUID, Document],
    chunks: dict[uuid.UUID, DocumentChunk],
) -> list[CitationSourceOut]:
    return [
        _build_source(citation, documents, chunks)
        for citation in citations
        if isinstance(citation, dict)
    ]


async def _feedback_map(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[QuestionFeedbackOut]]:
    if not message_ids:
        return {}
    rows = await db.execute(
        select(Feedback)
        .where(Feedback.message_id.in_(message_ids))
        .order_by(Feedback.created_at.asc())
    )
    result: dict[uuid.UUID, list[QuestionFeedbackOut]] = {}
    for feedback in rows.scalars().all():
        result.setdefault(feedback.message_id, []).append(
            QuestionFeedbackOut(
                id=feedback.id,
                feedback_type=feedback.feedback_type.value,
                comment=feedback.comment,
                review_status=feedback.review_status,
                created_at=feedback.created_at,
            )
        )
    return result


# ─── Recent questions / detail ────────────────────────────────────────────


async def recent_questions(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    user_id: uuid.UUID,
    limit: int = 8,
) -> list[RecentQuestion]:
    rows = await _question_rows(
        db, organization_id, user_id=user_id, limit=limit
    )
    citation_lists = [
        list(row[3].citations or []) if row[3] is not None else [] for row in rows
    ]
    documents, chunks = await _source_maps(db, organization_id, citation_lists)
    answer_ids = [row[3].id for row in rows if row[3] is not None]
    feedback = await _feedback_map(db, answer_ids)

    recent: list[RecentQuestion] = []
    for row, citations in zip(rows, citation_lists, strict=True):
        question, conversation, _user, reply, _feedback_count = row
        recent.append(
            RecentQuestion(
                id=question.id,
                conversation_id=conversation.id,
                conversation_title=conversation.title,
                question=question.content,
                answer=reply.content if reply is not None else None,
                asked_at=question.created_at,
                answered_at=reply.created_at if reply is not None else None,
                model_used=reply.model_used if reply is not None else None,
                input_tokens=_int(reply.input_tokens) if reply is not None else 0,
                output_tokens=(
                    _int(reply.output_tokens) if reply is not None else 0
                ),
                cost_usd=(
                    _cost_usd(
                        _int(reply.input_tokens), _int(reply.output_tokens)
                    )
                    if reply is not None
                    else 0.0
                ),
                latency_ms=reply.latency_ms if reply is not None else None,
                sources=_build_sources(citations, documents, chunks),
                feedback=(
                    feedback.get(reply.id, []) if reply is not None else []
                ),
            )
        )
    return recent


async def question_detail(
    db: AsyncSession,
    organization_id: uuid.UUID,
    message_id: uuid.UUID,
) -> QuestionDetailOut:
    row = (
        await db.execute(
            select(Message, Conversation, User)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(User, User.id == Message.user_id)
            .where(
                Message.id == message_id,
                Message.organization_id == organization_id,
                Message.role == MessageRole.USER,
            )
        )
    ).first()
    if row is None:
        raise NotFoundError("Question not found.")

    question, conversation, user = row
    reply = await db.scalar(
        select(Message)
        .where(
            Message.conversation_id == question.conversation_id,
            Message.organization_id == organization_id,
            Message.role == MessageRole.ASSISTANT,
            Message.created_at >= question.created_at,
        )
        .order_by(Message.created_at.asc())
        .limit(1)
    )

    citations = list(reply.citations or []) if reply is not None else []
    documents, chunks = await _source_maps(db, organization_id, [citations])
    sources = _build_sources(citations, documents, chunks)
    feedback = (
        (await _feedback_map(db, [reply.id])).get(reply.id, [])
        if reply is not None
        else []
    )

    usage: UsageRecord | None = None
    if reply is not None:
        usage = await db.scalar(
            select(UsageRecord).where(UsageRecord.message_id == reply.id)
        )
        if usage is None:
            usage = await db.scalar(
                select(UsageRecord)
                .where(
                    UsageRecord.organization_id == organization_id,
                    UsageRecord.user_id == question.user_id,
                    UsageRecord.conversation_id == question.conversation_id,
                )
                .order_by(UsageRecord.created_at.desc())
                .limit(1)
            )

    retrieval_latency = usage.retrieval_latency_ms if usage is not None else None
    flow: list[FlowStep] = [
        FlowStep(
            stage="question",
            label="Question received",
            status="complete",
            timestamp=question.created_at,
            detail=f"Asked in “{conversation.title}”",
        ),
        FlowStep(
            stage="retrieval",
            label="Document retrieval",
            status="complete" if sources else "empty",
            detail=(
                f"{len(sources)} source(s)"
                + (
                    f" · {retrieval_latency} ms"
                    if retrieval_latency is not None
                    else ""
                )
            ),
        ),
        FlowStep(
            stage="generation",
            label="Answer generated",
            status="complete" if reply is not None else "pending",
            timestamp=reply.created_at if reply is not None else None,
            detail=(
                f"{reply.model_used or 'unknown model'} · "
                f"{_int(reply.input_tokens) + _int(reply.output_tokens)} tokens · "
                f"{reply.latency_ms or 0} ms"
                if reply is not None
                else None
            ),
        ),
        FlowStep(
            stage="feedback",
            label="User feedback",
            status="received" if feedback else "none",
            timestamp=feedback[0].created_at if feedback else None,
            detail=(
                ", ".join(item.feedback_type.replace("_", " ") for item in feedback)
                if feedback
                else None
            ),
        ),
    ]

    return QuestionDetailOut(
        id=question.id,
        question=question.content,
        asked_at=question.created_at,
        user_id=user.id,
        user_name=user.full_name,
        user_email=user.email,
        conversation_id=conversation.id,
        conversation_title=conversation.title,
        answer_id=reply.id if reply is not None else None,
        answer=reply.content if reply is not None else None,
        answered_at=reply.created_at if reply is not None else None,
        model_used=reply.model_used if reply is not None else None,
        input_tokens=_int(reply.input_tokens) if reply is not None else 0,
        output_tokens=_int(reply.output_tokens) if reply is not None else 0,
        cost_usd=(
            _cost_usd(_int(reply.input_tokens), _int(reply.output_tokens))
            if reply is not None
            else 0.0
        ),
        latency_ms=reply.latency_ms if reply is not None else None,
        retrieval_latency_ms=retrieval_latency,
        sources=sources,
        feedback=feedback,
        flow=flow,
    )


# ─── Per-user analytics ───────────────────────────────────────────────────


def _user_stats_select(organization_id: uuid.UUID) -> Any:
    questions = (
        select(func.count(Message.id))
        .where(
            Message.user_id == User.id,
            Message.organization_id == organization_id,
            Message.role == MessageRole.USER,
        )
        .correlate(User)
        .scalar_subquery()
    )
    conversations = (
        select(func.count(Conversation.id))
        .where(
            Conversation.user_id == User.id,
            Conversation.organization_id == organization_id,
            Conversation.is_active == True,  # noqa: E712
        )
        .correlate(User)
        .scalar_subquery()
    )
    tokens = (
        select(
            func.coalesce(
                func.sum(
                    func.coalesce(Message.input_tokens, 0)
                    + func.coalesce(Message.output_tokens, 0)
                ),
                0,
            )
        )
        .where(
            Message.user_id == User.id,
            Message.organization_id == organization_id,
            Message.role == MessageRole.ASSISTANT,
        )
        .correlate(User)
        .scalar_subquery()
    )
    input_tokens = (
        select(func.coalesce(func.sum(Message.input_tokens), 0))
        .where(
            Message.user_id == User.id,
            Message.organization_id == organization_id,
            Message.role == MessageRole.ASSISTANT,
        )
        .correlate(User)
        .scalar_subquery()
    )
    output_tokens = (
        select(func.coalesce(func.sum(Message.output_tokens), 0))
        .where(
            Message.user_id == User.id,
            Message.organization_id == organization_id,
            Message.role == MessageRole.ASSISTANT,
        )
        .correlate(User)
        .scalar_subquery()
    )
    avg_latency = (
        select(func.avg(Message.latency_ms))
        .where(
            Message.user_id == User.id,
            Message.organization_id == organization_id,
            Message.role == MessageRole.ASSISTANT,
            Message.latency_ms.is_not(None),
        )
        .correlate(User)
        .scalar_subquery()
    )
    feedback_count = (
        select(func.count(Feedback.id))
        .where(
            Feedback.user_id == User.id,
            Feedback.organization_id == organization_id,
        )
        .correlate(User)
        .scalar_subquery()
    )
    last_active = (
        select(func.max(Message.created_at))
        .where(
            Message.user_id == User.id,
            Message.organization_id == organization_id,
        )
        .correlate(User)
        .scalar_subquery()
    )
    return select(
        User,
        OrganizationMembership,
        questions.label("questions"),
        conversations.label("conversations"),
        tokens.label("tokens"),
        input_tokens.label("input_tokens"),
        output_tokens.label("output_tokens"),
        avg_latency.label("avg_latency"),
        feedback_count.label("feedback_count"),
        last_active.label("last_active"),
    ).join(
        OrganizationMembership,
        and_(
            OrganizationMembership.user_id == User.id,
            OrganizationMembership.organization_id == organization_id,
        ),
    )


def _user_row(row: Any) -> UserAnalyticsRow:
    (
        user,
        membership,
        questions,
        conversations,
        tokens,
        input_tokens,
        output_tokens,
        avg_latency,
        feedback,
        last,
    ) = row
    return UserAnalyticsRow(
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=_api_role(user, membership),
        is_active=membership.is_active,
        is_platform_admin=user.is_platform_admin,
        questions=_int(questions),
        conversations=_int(conversations),
        tokens=_int(tokens),
        input_tokens=_int(input_tokens),
        output_tokens=_int(output_tokens),
        cost_usd=_cost_usd(_int(input_tokens), _int(output_tokens)),
        avg_latency_ms=_float(avg_latency),
        feedback_count=_int(feedback),
        last_active_at=last,
    )


async def user_analytics_rows(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> UserAnalyticsListResponse:
    stmt = _user_stats_select(organization_id)
    count_stmt = (
        select(func.count(OrganizationMembership.id))
        .join(User, User.id == OrganizationMembership.user_id)
        .where(OrganizationMembership.organization_id == organization_id)
    )
    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(User.full_name.ilike(term), User.email_normalized.ilike(term))
        )
        count_stmt = count_stmt.where(
            or_(User.full_name.ilike(term), User.email_normalized.ilike(term))
        )

    total = _int(await db.scalar(count_stmt))
    last_active = stmt.selected_columns.last_active
    rows = (
        await db.execute(
            stmt.order_by(
                desc(last_active).nulls_last(), User.full_name.asc()
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return UserAnalyticsListResponse(
        items=[_user_row(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


async def user_analytics_row(
    db: AsyncSession, organization_id: uuid.UUID, user_id: uuid.UUID
) -> UserAnalyticsRow | None:
    stmt = _user_stats_select(organization_id).where(User.id == user_id)
    row = (await db.execute(stmt)).first()
    return _user_row(row) if row is not None else None


# ─── Document explorer ────────────────────────────────────────────────────


def _document_citation_count(organization_id: uuid.UUID) -> Any:
    """Count assistant messages whose citations reference this document.

    Citations are JSONB arrays, so the check expands each element and compares
    its ``document_id`` field. This avoids substring false positives from a
    plain ``LIKE`` over the serialized JSON.
    """
    citation = _citation_elements()
    reference = (
        select(1)
        .select_from(citation)
        .where(citation.c.value.op("->>")("document_id") == cast(Document.id, Text))
        .correlate(Message)
    )
    return (
        select(func.count(Message.id))
        .where(
            Message.organization_id == organization_id,
            Message.citations.is_not(None),
            exists(reference),
        )
        .correlate(Document)
        .scalar_subquery()
    )


def _document_row(row: Any) -> AdminDocumentRow:
    document, uploader, citation_count = row
    return AdminDocumentRow(
        id=document.id,
        title=document.title,
        original_filename=document.original_filename,
        mime_type=document.mime_type,
        file_extension=document.file_extension,
        file_size_bytes=document.file_size_bytes,
        status=document.status.value,
        page_count=document.page_count,
        chunk_count=document.chunk_count,
        word_count=document.word_count,
        uploaded_by=document.uploaded_by,
        uploaded_by_name=uploader.full_name if uploader is not None else None,
        uploaded_by_email=uploader.email if uploader is not None else None,
        citation_count=_int(citation_count),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


async def list_documents(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[AdminDocumentRow], int]:
    filters = [
        Document.organization_id == organization_id,
        Document.is_active == True,  # noqa: E712
    ]
    if status:
        filters.append(Document.status == status)
    if search:
        term = f"%{search.strip()}%"
        filters.append(
            or_(Document.title.ilike(term), Document.original_filename.ilike(term))
        )

    total = _int(
        await db.scalar(select(func.count(Document.id)).where(*filters))
    )
    rows = (
        await db.execute(
            select(
                Document,
                User,
                _document_citation_count(organization_id).label("citation_count"),
            )
            .outerjoin(User, User.id == Document.uploaded_by)
            .where(*filters)
            .order_by(Document.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return [_document_row(row) for row in rows], total


async def document_detail(
    db: AsyncSession,
    organization_id: uuid.UUID,
    document_id: uuid.UUID,
) -> AdminDocumentDetailOut:
    row = (
        await db.execute(
            select(
                Document,
                User,
                _document_citation_count(organization_id).label("citation_count"),
            )
            .outerjoin(User, User.id == Document.uploaded_by)
            .where(
                Document.id == document_id,
                Document.organization_id == organization_id,
                Document.is_active == True,  # noqa: E712
            )
        )
    ).first()
    if row is None:
        raise NotFoundError("Document not found.")

    document = row[0]
    base = _document_row(row)

    jobs = (
        await db.execute(
            select(DocumentProcessingJob)
            .where(
                DocumentProcessingJob.document_id == document.id,
                DocumentProcessingJob.organization_id == organization_id,
            )
            .order_by(DocumentProcessingJob.created_at.desc())
        )
    ).scalars().all()
    chunks = (
        await db.execute(
            select(DocumentChunk)
            .where(
                DocumentChunk.document_id == document.id,
                DocumentChunk.organization_id == organization_id,
            )
            .order_by(DocumentChunk.chunk_index.asc())
            .limit(10)
        )
    ).scalars().all()

    return AdminDocumentDetailOut(
        **base.model_dump(),
        language=document.language,
        embedding_model=document.embedding_model,
        checksum_sha256=document.checksum_sha256,
        jobs=[
            DocumentJobOut(
                id=job.id,
                status=job.status.value,
                attempt_number=job.attempt_number,
                error_type=job.error_type,
                error_message=job.error_message,
                started_at=job.started_at,
                completed_at=job.completed_at,
            )
            for job in jobs
        ],
        chunks=[
            DocumentChunkPreview(
                id=chunk.id,
                chunk_index=chunk.chunk_index,
                page_number=chunk.page_number,
                section_heading=chunk.section_heading,
                token_count=chunk.token_count,
                excerpt=chunk.content[:400],
            )
            for chunk in chunks
        ],
    )
