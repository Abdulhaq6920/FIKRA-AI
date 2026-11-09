"""
Chat and conversation API endpoints.

POST /api/v1/chat/conversations
GET  /api/v1/chat/conversations
GET  /api/v1/chat/conversations/{conv_id}/messages
DELETE /api/v1/chat/conversations/{conv_id}
PATCH  /api/v1/chat/conversations/{conv_id}
POST /api/v1/chat/ask
POST /api/v1/chat/ask/stream
POST /api/v1/chat/ask/stream/cancel
POST /api/v1/chat/feedback
POST /api/v1/chat/messages/{message_id}/feedback
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, get_llm_client
from app.core.config import settings
from app.core.exceptions import (
    AppError,
    ConversationNotFoundError,
    PermissionDeniedError,
)
from app.core.logging import get_logger
from app.db.models.audit import Notification
from app.db.models.conversation import (
    Conversation,
    Feedback,
    FeedbackType,
    Message,
    MessageRole,
)
from app.db.models.user import OrganizationMembership, OrgRole
from app.db.session import get_db
from app.providers.llm import LLMClient
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    CitationOut,
    ConversationCreate,
    ConversationListOut,
    ConversationOut,
    ConversationUpdate,
    FeedbackRequest,
    MessageListOut,
    MessageOut,
)
from app.services.rag_service import RAGService

router = APIRouter(prefix="/chat", tags=["chat"])

logger = get_logger(__name__)

# In-memory cancel registry: maps stream_key → asyncio.Event
# stream_key = f"{user_id}:{conversation_id}"
_cancel_events: dict[str, asyncio.Event] = {}


@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    """Create a new conversation."""
    user, org_id, role = ctx
    conv = Conversation(
        organization_id=org_id,
        user_id=user.id,
        title=body.title,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationOut.model_validate(conv)


@router.get("/conversations", response_model=ConversationListOut)
async def list_conversations(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> ConversationListOut:
    """List the user's conversations, newest first, paginated."""
    user, org_id, role = ctx
    base = select(Conversation).where(
        Conversation.user_id == user.id,
        Conversation.organization_id == org_id,
        Conversation.is_active == True,  # noqa: E712
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    result = await db.execute(
        base.order_by(Conversation.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    convs = result.scalars().all()
    return ConversationListOut(
        items=[ConversationOut.model_validate(c) for c in convs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
async def rename_conversation(
    conv_id: uuid.UUID,
    body: ConversationUpdate,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    """Rename a conversation."""
    user, org_id, role = ctx
    conv = await _get_conv_or_404(conv_id, user.id, org_id, db)
    conv.title = body.title
    await db.commit()
    await db.refresh(conv)
    return ConversationOut.model_validate(conv)


@router.delete("/conversations/{conv_id}", status_code=204, response_model=None)
async def delete_conversation(
    conv_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete a conversation and its messages."""
    user, org_id, role = ctx
    conv = await _get_conv_or_404(conv_id, user.id, org_id, db)
    conv.is_active = False
    await db.commit()


@router.get(
    "/conversations/{conv_id}/messages",
    response_model=MessageListOut,
)
async def get_messages(
    conv_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
) -> MessageListOut:
    """Return a page of messages for a conversation, oldest first.

    Pagination anchors to the newest block: page 1 is the most recent
    ``page_size`` messages, page 2 the block right before it, and so on.
    New messages therefore never shift already-fetched history around.
    """
    user, org_id, role = ctx
    await _get_conv_or_404(conv_id, user.id, org_id, db)  # ownership check

    base = select(Message).where(
        Message.conversation_id == conv_id,
        Message.organization_id == org_id,
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0

    # Window counted from the end of the timeline so page 1 = newest block.
    offset = max(0, total - page_size * page)
    result = await db.execute(
        base.order_by(Message.created_at.asc()).offset(offset).limit(page_size)
    )
    msgs = result.scalars().all()
    return MessageListOut(
        items=[MessageOut.model_validate(m) for m in msgs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/ask", response_model=ChatResponse)
async def ask(
    body: ChatRequest,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    llm: LLMClient = Depends(get_llm_client),
) -> ChatResponse:
    """
    Answer a question using the RAG pipeline.

    The conversation must belong to the authenticated user.
    """
    user, org_id, role = ctx

    rag = RAGService(db=db, llm=llm)
    result = await rag.answer(
        question=body.question,
        conversation_id=body.conversation_id,
        user_id=user.id,
        organization_id=org_id,
        include_restricted=role == OrgRole.ORG_ADMIN,
    )

    # Persist user message
    user_msg = Message(
        conversation_id=body.conversation_id,
        organization_id=org_id,
        user_id=user.id,
        role=MessageRole.USER,
        content=body.question,
    )
    db.add(user_msg)
    await db.flush()

    # Persist assistant message
    citations_data = [
        {
            "source_number": c.source_number,
            "document_id": c.document_id,
            "document_title": c.document_title,
            "page_number": c.page_number,
            "section_heading": c.section_heading,
            "excerpt": c.excerpt,
            "chunk_id": c.chunk_id,
            "retrieval_method": c.retrieval_method,
            "similarity": c.similarity,
        }
        for c in result.citations
    ]
    asst_msg = Message(
        conversation_id=body.conversation_id,
        organization_id=org_id,
        user_id=user.id,
        role=MessageRole.ASSISTANT,
        content=result.answer,
        model_used=result.model_used,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        latency_ms=result.latency_ms,
        citations=citations_data or None,
    )
    db.add(asst_msg)
    # Flush so the usage record can reference the assistant message.
    await db.flush()

    # Update conversation metadata
    conv = await db.get(Conversation, body.conversation_id)
    if conv:
        conv.message_count += 2

    # Record usage
    from app.db.models.audit import UsageRecord

    usage = UsageRecord(
        organization_id=org_id,
        user_id=user.id,
        conversation_id=body.conversation_id,
        message_id=asst_msg.id,
        model=result.model_used,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        total_tokens=result.input_tokens + result.output_tokens,
        request_latency_ms=result.latency_ms,
        retrieval_latency_ms=result.retrieval_latency_ms,
    )
    db.add(usage)
    await db.commit()
    await db.refresh(asst_msg)

    return ChatResponse(
        answer=result.answer,
        citations=[CitationOut(**c.__dict__) for c in result.citations],
        conversation_id=body.conversation_id,
        message_id=asst_msg.id,
        model_used=result.model_used,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        latency_ms=result.latency_ms,
    )


@router.post("/ask/stream/cancel", status_code=204, response_model=None)
async def cancel_stream(
    body: ChatRequest,
    ctx: CurrentUser,
) -> None:
    """Signal a running stream to stop. The stream checks this every chunk."""
    user, _org_id, _role = ctx
    key = f"{user.id}:{body.conversation_id}"
    event = _cancel_events.get(key)
    if event:
        event.set()


@router.post("/ask/stream")
async def ask_stream(
    body: ChatRequest,
    request: Request,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    llm: LLMClient = Depends(get_llm_client),
) -> StreamingResponse:
    """Stream the RAG answer as Server-Sent Events."""
    user, org_id, role = ctx

    # Set up a cancel event for this stream (keyed by user+conversation)
    stream_key = f"{user.id}:{body.conversation_id}"
    cancel_event = asyncio.Event()
    _cancel_events[stream_key] = cancel_event

    rag = RAGService(db=db, llm=llm)

    async def event_stream() -> AsyncIterator[str]:
        answer_parts: list[str] = []
        client_disconnected = False
        try:
            async for chunk in rag.answer_stream(
                question=body.question,
                conversation_id=body.conversation_id,
                user_id=user.id,
                organization_id=org_id,
                include_restricted=role == OrgRole.ORG_ADMIN,
            ):
                if cancel_event.is_set() or await request.is_disconnected():
                    client_disconnected = True
                    break
                answer_parts.append(chunk)
                # JSON protects newlines and other SSE-sensitive characters in
                # model output. The frontend decodes one complete event at a time.
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            answer = "".join(answer_parts)
            result = rag.last_stream_result
            if answer and not client_disconnected and result is not None:
                citations_data = [
                    {
                        "source_number": citation.source_number,
                        "document_id": citation.document_id,
                        "document_title": citation.document_title,
                        "page_number": citation.page_number,
                        "section_heading": citation.section_heading,
                        "excerpt": citation.excerpt,
                        "chunk_id": citation.chunk_id,
                        "retrieval_method": citation.retrieval_method,
                        "similarity": citation.similarity,
                    }
                    for citation in result.citations
                ]
                user_message = Message(
                    conversation_id=body.conversation_id,
                    organization_id=org_id,
                    user_id=user.id,
                    role=MessageRole.USER,
                    content=body.question,
                )
                assistant_message = Message(
                    conversation_id=body.conversation_id,
                    organization_id=org_id,
                    user_id=user.id,
                    role=MessageRole.ASSISTANT,
                    content=answer,
                    model_used=result.model_used or settings.active_llm_model,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    latency_ms=result.latency_ms,
                    citations=citations_data or None,
                )
                db.add_all([user_message, assistant_message])
                # Flush so the usage record can reference the assistant message.
                await db.flush()

                from app.db.models.audit import UsageRecord

                db.add(
                    UsageRecord(
                        organization_id=org_id,
                        user_id=user.id,
                        conversation_id=body.conversation_id,
                        message_id=assistant_message.id,
                        model=result.model_used or settings.active_llm_model,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        total_tokens=result.input_tokens + result.output_tokens,
                        request_latency_ms=result.latency_ms,
                        retrieval_latency_ms=result.retrieval_latency_ms,
                    )
                )

                conversation = await db.get(Conversation, body.conversation_id)
                if conversation:
                    conversation.message_count += 2
                await db.commit()

                # Final metadata event so the client can show citations and
                # use the real message IDs (feedback) without reloading.
                meta_event = {
                    "meta": {
                        "user_message_id": str(user_message.id),
                        "assistant_message_id": str(assistant_message.id),
                        "model_used": assistant_message.model_used,
                        "citations": citations_data,
                    }
                }
                yield f"data: {json.dumps(meta_event)}\n\n"
        except AppError as exc:
            # Typed application errors carry a stable code and a user-safe
            # message (e.g. the provider rate limit being reached).
            yield (
                "data: " + json.dumps({"error": exc.error_code, "message": exc.message}) + "\n\n"
            )
        except Exception as exc:
            # Unexpected failures stay opaque to the client — the exception
            # class name alone fingerprints internals; log details instead.
            logger.exception("chat_stream_unexpected_error", error=str(exc)[:200])
            generic = {"error": "internal_error", "message": "Something went wrong."}
            yield f"data: {json.dumps(generic)}\n\n"
        finally:
            # Always clean up the cancel event
            _cancel_events.pop(stream_key, None)
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/messages/{message_id}/feedback", status_code=201)
async def submit_feedback_by_message(
    message_id: uuid.UUID,
    body: FeedbackRequest,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Submit feedback on an assistant message via per-message URL."""
    # Reuse the same body schema but override message_id from the path
    overridden = FeedbackRequest(
        message_id=message_id,
        feedback_type=body.feedback_type,
        comment=body.comment,
    )
    return await _do_submit_feedback(overridden, ctx, db)


@router.post("/feedback", status_code=201)
async def submit_feedback(
    body: FeedbackRequest,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Submit feedback on an assistant message."""
    return await _do_submit_feedback(body, ctx, db)


async def _do_submit_feedback(
    body: FeedbackRequest,
    ctx,
    db: AsyncSession,
) -> dict:
    user, org_id, role = ctx

    # Verify the message belongs to this org and user
    msg = await db.scalar(
        select(Message).where(
            Message.id == body.message_id,
            Message.organization_id == org_id,
            Message.user_id == user.id,
        )
    )
    if msg is None:
        raise PermissionDeniedError("Message not found or access denied.")

    fb = Feedback(
        message_id=body.message_id,
        user_id=user.id,
        organization_id=org_id,
        feedback_type=FeedbackType(body.feedback_type),
        comment=body.comment,
    )
    db.add(fb)
    # Alert only admins in the same organization about actionable negative feedback.
    if body.feedback_type == "thumbs_down":
        admin_ids = (
            (
                await db.execute(
                    select(OrganizationMembership.user_id).where(
                        OrganizationMembership.organization_id == org_id,
                        OrganizationMembership.is_active == True,  # noqa: E712
                        OrganizationMembership.role == OrgRole.ORG_ADMIN,
                    )
                )
            )
            .scalars()
            .all()
        )
        for admin_id in admin_ids:
            db.add(
                Notification(
                    organization_id=org_id,
                    recipient_user_id=admin_id,
                    notification_type="negative_feedback",
                    title="New negative response feedback",
                    body="A user reported an answer that needs review.",
                    link="/admin",
                )
            )
    await db.commit()
    return {"status": "received"}


async def _get_conv_or_404(
    conv_id: uuid.UUID,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    db,
) -> Conversation:
    conv = await db.scalar(
        select(Conversation).where(
            Conversation.id == conv_id,
            Conversation.user_id == user_id,
            Conversation.organization_id == org_id,
            Conversation.is_active == True,  # noqa: E712
        )
    )
    if conv is None:
        raise ConversationNotFoundError()
    return conv
