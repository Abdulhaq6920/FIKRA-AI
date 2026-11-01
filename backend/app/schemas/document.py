"""Pydantic schemas for document management endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DocumentOut(BaseModel):
    id: uuid.UUID
    title: str
    original_filename: str
    mime_type: str
    file_size_bytes: int
    status: str
    access_level: str
    page_count: int | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    page_size: int


class ProcessingJobOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    status: str
    attempt_number: int
    error_type: str | None
    error_message: str | None
    started_at: str | None
    completed_at: str | None

    model_config = {"from_attributes": True}
