"""Organization-wide analytics and drill-down endpoints for admins.

All endpoints are tenant-scoped from the signed JWT and require the org-admin
(or platform-admin) role via :data:`OrgAdminUser`. Detail endpoints return 404
for IDs that belong to another organization so the API never confirms the
existence of cross-tenant records.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import OrgAdminUser
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.schemas.analytics import (
    AdminDocumentDetailOut,
    AdminDocumentListResponse,
    OrgAnalyticsOut,
    QuestionDetailOut,
    QuestionListResponse,
    UserAnalyticsDetailOut,
)
from app.services.insights_service import (
    build_summary,
    daily_activity,
    document_detail,
    list_documents,
    list_questions,
    question_detail,
    recent_questions,
    top_sources,
    user_analytics_row,
    user_analytics_rows,
)

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── Analytics ────────────────────────────────────────────────────────────


@router.get("/analytics", response_model=OrgAnalyticsOut)
async def organization_analytics(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    days: int = Query(default=14, ge=1, le=90),
    search: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> OrgAnalyticsOut:
    """Organization metrics plus a paginated, per-user breakdown."""
    _admin, org_id, _role = ctx

    summary = await build_summary(db, org_id, include_admin=True)
    daily = await daily_activity(db, org_id, days=days)
    sources = await top_sources(db, org_id)
    users = await user_analytics_rows(db, org_id, search=search, page=page, page_size=page_size)
    return OrgAnalyticsOut(
        summary=summary,
        daily=daily,
        top_sources=sources,
        users=users,
    )


@router.get("/analytics/users/{user_id}", response_model=UserAnalyticsDetailOut)
async def organization_user_analytics(
    user_id: uuid.UUID,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    days: int = Query(default=14, ge=1, le=90),
) -> UserAnalyticsDetailOut:
    """Per-user analytics for an active or inactive member of this organization."""
    _admin, org_id, _role = ctx

    row = await user_analytics_row(db, org_id, user_id)
    if row is None:
        raise NotFoundError("User not found in this organization.")

    summary = await build_summary(db, org_id, user_id=user_id)
    daily = await daily_activity(db, org_id, user_id=user_id, days=days)
    sources = await top_sources(db, org_id, user_id=user_id)
    recent = await recent_questions(db, org_id, user_id=user_id, limit=10)
    return UserAnalyticsDetailOut(
        user=row,
        summary=summary,
        daily=daily,
        top_sources=sources,
        recent_questions=recent,
    )


# ─── Question explorer ────────────────────────────────────────────────────


@router.get("/questions", response_model=QuestionListResponse)
async def admin_questions(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    search: str | None = Query(default=None, max_length=255),
    user_id: uuid.UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> QuestionListResponse:
    """List questions with their user, conversation, answer, and usage metrics."""
    _admin, org_id, _role = ctx

    items, total = await list_questions(
        db,
        org_id,
        user_id=user_id,
        search=search,
        page=page,
        page_size=page_size,
    )
    return QuestionListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/questions/{message_id}", response_model=QuestionDetailOut)
async def admin_question_detail(
    message_id: uuid.UUID,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> QuestionDetailOut:
    """Full question flow: answer, retrieval sources, usage, and feedback."""
    _admin, org_id, _role = ctx
    return await question_detail(db, org_id, message_id)


# ─── Document explorer ────────────────────────────────────────────────────


@router.get("/documents", response_model=AdminDocumentListResponse)
async def admin_documents(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    search: str | None = Query(default=None, max_length=255),
    status: str | None = Query(
        default=None,
        pattern="^(pending|queued|processing|ready|failed|reindexing)$",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminDocumentListResponse:
    """List documents with uploader and citation metrics."""
    _admin, org_id, _role = ctx

    items, total = await list_documents(
        db, org_id, search=search, status=status, page=page, page_size=page_size
    )
    return AdminDocumentListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/documents/{document_id}", response_model=AdminDocumentDetailOut)
async def admin_document_detail(
    document_id: uuid.UUID,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> AdminDocumentDetailOut:
    """Document metadata, processing jobs, and chunk previews."""
    _admin, org_id, _role = ctx
    return await document_detail(db, org_id, document_id)
