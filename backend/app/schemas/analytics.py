"""Schemas for organization and personal analytics plus admin drill-downs."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel

# ─── Shared analytics ─────────────────────────────────────────────────────


class AnalyticsSummary(BaseModel):
    total_questions: int = 0
    total_conversations: int = 0
    total_tokens: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    # Estimated provider spend in USD; the client converts to the chosen
    # display currency (USD or INR).
    total_cost_usd: float = 0.0
    avg_latency_ms: float | None = None
    # Populated for organization analytics only.
    total_users: int | None = None
    active_users: int | None = None
    total_documents: int | None = None
    total_feedback: int | None = None
    positive_feedback: int | None = None
    negative_feedback: int | None = None


class DailyPoint(BaseModel):
    date: date
    questions: int
    tokens: int
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class SourceStat(BaseModel):
    document_id: str | None = None
    document_title: str
    citations: int


class UserAnalyticsRow(BaseModel):
    user_id: uuid.UUID
    full_name: str
    email: str
    role: str
    is_active: bool
    is_platform_admin: bool
    questions: int
    conversations: int
    tokens: int
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    avg_latency_ms: float | None = None
    feedback_count: int = 0
    last_active_at: datetime | None = None


class UserAnalyticsListResponse(BaseModel):
    items: list[UserAnalyticsRow]
    total: int
    page: int
    page_size: int


# ─── Question explorer ────────────────────────────────────────────────────


class QuestionFeedbackOut(BaseModel):
    id: uuid.UUID
    feedback_type: str
    comment: str | None
    review_status: str
    created_at: datetime


class CitationSourceOut(BaseModel):
    source_number: int
    document_id: str | None = None
    document_title: str
    page_number: int | None = None
    section_heading: str | None = None
    excerpt: str
    chunk_id: str | None = None
    retrieval_method: str | None = None
    similarity: float | None = None
    # Enriched from the live document/chunk records (may be unavailable when
    # the source document was deleted after the answer was generated).
    document_original_filename: str | None = None
    document_mime_type: str | None = None
    document_status: str | None = None
    chunk_content: str | None = None
    chunk_token_count: int | None = None


class QuestionListItem(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    user_email: str
    conversation_id: uuid.UUID
    conversation_title: str
    question: str
    answer_excerpt: str | None = None
    asked_at: datetime
    answered_at: datetime | None = None
    model_used: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int | None = None
    citation_count: int = 0
    feedback_count: int = 0


class QuestionListResponse(BaseModel):
    items: list[QuestionListItem]
    total: int
    page: int
    page_size: int


class FlowStep(BaseModel):
    stage: str
    label: str
    status: str
    timestamp: datetime | None = None
    detail: str | None = None


class QuestionDetailOut(BaseModel):
    id: uuid.UUID
    question: str
    asked_at: datetime
    user_id: uuid.UUID
    user_name: str
    user_email: str
    conversation_id: uuid.UUID
    conversation_title: str
    answer_id: uuid.UUID | None = None
    answer: str | None = None
    answered_at: datetime | None = None
    model_used: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int | None = None
    retrieval_latency_ms: int | None = None
    sources: list[CitationSourceOut]
    feedback: list[QuestionFeedbackOut]
    flow: list[FlowStep]


class RecentQuestion(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    conversation_title: str
    question: str
    answer: str | None = None
    asked_at: datetime
    answered_at: datetime | None = None
    model_used: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int | None = None
    sources: list[CitationSourceOut]
    feedback: list[QuestionFeedbackOut]


# ─── Analytics responses ──────────────────────────────────────────────────


class PersonalAnalyticsOut(BaseModel):
    summary: AnalyticsSummary
    daily: list[DailyPoint]
    top_sources: list[SourceStat]
    recent_questions: list[RecentQuestion]


class OrgAnalyticsOut(BaseModel):
    summary: AnalyticsSummary
    daily: list[DailyPoint]
    top_sources: list[SourceStat]
    users: UserAnalyticsListResponse


class UserAnalyticsDetailOut(BaseModel):
    user: UserAnalyticsRow
    summary: AnalyticsSummary
    daily: list[DailyPoint]
    top_sources: list[SourceStat]
    recent_questions: list[RecentQuestion]


# ─── Document explorer ────────────────────────────────────────────────────


class AdminDocumentRow(BaseModel):
    id: uuid.UUID
    title: str
    original_filename: str
    mime_type: str
    file_extension: str
    file_size_bytes: int
    status: str
    page_count: int | None = None
    chunk_count: int = 0
    word_count: int | None = None
    uploaded_by: uuid.UUID | None = None
    uploaded_by_name: str | None = None
    uploaded_by_email: str | None = None
    citation_count: int = 0
    created_at: datetime
    updated_at: datetime


class AdminDocumentListResponse(BaseModel):
    items: list[AdminDocumentRow]
    total: int
    page: int
    page_size: int


class DocumentJobOut(BaseModel):
    id: uuid.UUID
    status: str
    attempt_number: int
    error_type: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class DocumentChunkPreview(BaseModel):
    id: uuid.UUID
    chunk_index: int
    page_number: int | None = None
    section_heading: str | None = None
    token_count: int = 0
    excerpt: str


class AdminDocumentDetailOut(AdminDocumentRow):
    language: str | None = None
    embedding_model: str | None = None
    checksum_sha256: str
    jobs: list[DocumentJobOut]
    chunks: list[DocumentChunkPreview]
