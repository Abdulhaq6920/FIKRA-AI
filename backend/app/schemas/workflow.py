"""Schemas for notifications, feedback review, and admin access requests."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RoleRequestCreate(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class ReviewDecision(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    note: str | None = Field(default=None, max_length=1000)


class FeedbackReviewUpdate(BaseModel):
    status: str = Field(pattern="^(in_review|solved)$")
    note: str | None = Field(default=None, max_length=1000)


class NotificationOut(BaseModel):
    id: uuid.UUID
    notification_type: str
    title: str
    body: str
    link: str | None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    total: int
    page: int
    page_size: int
    unread: int


class AccessRequestOut(BaseModel):
    id: uuid.UUID
    user_name: str
    user_email: str
    reason: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AccessRequestListOut(BaseModel):
    items: list[AccessRequestOut]
    total: int
    page: int
    page_size: int


class AccessRequestStatusOut(BaseModel):
    status: str


class FeedbackReviewOut(BaseModel):
    status: str
