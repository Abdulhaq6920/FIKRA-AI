"""Pydantic schemas for chat and conversation endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator


class ConversationCreate(BaseModel):
    title: str = Field(default="New Conversation", max_length=512)


class ConversationUpdate(BaseModel):
    title: str = Field(max_length=512)


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str
    message_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationListOut(BaseModel):
    """Paginated conversation page (newest first)."""

    items: list[ConversationOut]
    total: int
    page: int
    page_size: int


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: uuid.UUID


class CitationOut(BaseModel):
    source_number: int
    document_id: str
    document_title: str
    page_number: int | None
    section_heading: str | None
    excerpt: str
    # Retrieval provenance — absent on citations stored before this field
    # was added, so keep them optional rather than failing validation.
    chunk_id: str | None = None
    retrieval_method: str | None = None
    similarity: float | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationOut]
    conversation_id: uuid.UUID
    message_id: uuid.UUID | None
    model_used: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    citations: list[CitationOut] | None
    model_used: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageListOut(BaseModel):
    """Paginated message window. Page 1 is always the most recent block."""

    items: list[MessageOut]
    total: int
    page: int
    page_size: int


class FavoriteQuestionCreate(BaseModel):
    """Question text saved to the authenticated user's shortcuts."""

    question: str = Field(min_length=1, max_length=500)

    @field_validator("question")
    @classmethod
    def normalise_question(cls, value: str) -> str:
        # Collapse whitespace so "What  is X?" and "What is X?" dedupe to the
        # same favourite, and reject whitespace-only submissions.
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("A favourite question cannot be empty.")
        return normalized


class FavoriteQuestionOut(BaseModel):
    id: uuid.UUID
    question: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FavoriteQuestionListOut(BaseModel):
    items: list[FavoriteQuestionOut]


class FeedbackRequest(BaseModel):
    message_id: uuid.UUID
    feedback_type: str = Field(
        pattern="^(thumbs_up|thumbs_down|incorrect_citation|missing_info|other)$"
    )
    comment: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def comment_required_for_negative_feedback(self) -> FeedbackRequest:
        if self.feedback_type == "thumbs_down" and not (self.comment or "").strip():
            raise ValueError("A short description is required for negative feedback.")
        return self
