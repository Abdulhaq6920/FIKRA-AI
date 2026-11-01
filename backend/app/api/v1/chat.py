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
import time
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, get_groq
from app.core.config import settings
from app.core.exceptions import ConversationNotFoundError, PermissionDeniedError
from app.db.models.audit import Notification
from app.db.models.conversation import (
    Conversation,
    Feedback,
    FeedbackType,
    Message,
    MessageRole,
)
from app.db.models.user import OrgRole, OrganizationMembership
from app.db.session import get_db
from app.providers.groq_client import GroqClient
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    CitationOut,
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    FeedbackRequest,
    MessageOut,
)
from app.services.rag_service import RAGService

router = APIRouter(prefix="/chat", tags=["chat"])

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


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    """List the user's conversations."""
    user, org_id, role = ctx
    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.user_id == user.id,
            Conversation.organization_id == org_id,
            Conversation.is_active == True,  # noqa: E712
        )
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    )
    convs = result.scalars().all()
    return [ConversationOut.model_validate(c) for c in convs]


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


@router.delete("/conversations/{conv_id}", status_code=204)
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


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conv_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """Return all messages for a conversation."""
    user, org_id, role = ctx
    await _get_conv_or_404(conv_id, user.id, org_id, db)  # ownership check

    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conv_id,
            Message.organization_id == org_id,
        )
        .order_by(Message.created_at.asc())
    )
    msgs = result.scalars().all()
    return [MessageOut.model_validate(m) for m in msgs]


@router.post("/ask", response_model=ChatResponse)
async def ask(
    body: ChatRequest,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    groq: GroqClient = Depends(get_groq),
) -> ChatResponse:
    """
    Answer a question using the RAG pipeline.

    The conversation must belong to the authenticated user.
    """
    user, org_id, role = ctx

    rag = RAGService(db=db, groq=groq)
    result = await rag.answer(
        question=body.question,
        conversation_id=body.conversation_id,
        user_id=user.id,
        organization_id=org_id,
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


@router.post("/ask/stream/cancel", status_code=204)
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
    groq: GroqClient = Depends(get_groq),
) -> StreamingResponse:
    """Stream the RAG answer as Server-Sent Events."""
    user, org_id, role = ctx

    # Set up a cancel event for this stream (keyed by user+conversation)
    stream_key = f"{user.id}:{body.conversation_id}"
    cancel_event = asyncio.Event()
    _cancel_events[stream_key] = cancel_event

    rag = RAGService(db=db, groq=groq)

    async def event_stream():
        answer_parts: list[str] = []
        client_disconnected = False
        started_at = time.perf_counter()
        try:
            async for chunk in rag.answer_stream(
                question=body.question,
                conversation_id=body.conversation_id,
                user_id=user.id,
                organization_id=org_id,
            ):
                if cancel_event.is_set() or await request.is_disconnected():
                    client_disconnected = True
                    break
                answer_parts.append(chunk)
                # JSON protects newlines and other SSE-sensitive characters in
                # model output. The frontend decodes one complete event at a time.
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            answer = "".join(answer_parts)
            if answer and not client_disconnected:
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
                    model_used=settings.groq_primary_model,
                    latency_ms=int((time.perf_counter() - started_at) * 1000),
                )
                db.add_all([user_message, assistant_message])
                conversation = await db.get(Conversation, body.conversation_id)
                if conversation:
                    conversation.message_count += 2
                await db.commit()
        except Exception as exc:
            yield f"data: {json.dumps({'error': type(exc).__name__})}\n\n"
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
            await db.execute(
                select(OrganizationMembership.user_id).where(
                    OrganizationMembership.organization_id == org_id,
                    OrganizationMembership.is_active == True,  # noqa: E712
                    OrganizationMembership.role == OrgRole.ORG_ADMIN,
                )
            )
        ).scalars().all()
        for admin_id in admin_ids:
            db.add(Notification(
                organization_id=org_id,
                recipient_user_id=admin_id,
                notification_type="negative_feedback",
                title="New negative response feedback",
                body="A user reported an answer that needs review.",
                link="/admin",
            ))
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
