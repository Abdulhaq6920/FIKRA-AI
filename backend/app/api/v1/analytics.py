"""Personal analytics endpoints.

Every metric is scoped to the authenticated user inside the organization taken
from the signed JWT — a user can only ever see their own activity here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.db.session import get_db
from app.schemas.analytics import PersonalAnalyticsOut
from app.services.insights_service import (
    build_summary,
    daily_activity,
    recent_questions,
    top_sources,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/me", response_model=PersonalAnalyticsOut)
async def personal_analytics(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    days: int = Query(default=14, ge=1, le=90),
) -> PersonalAnalyticsOut:
    """Return the caller's own question, token, source, and activity analytics."""
    user, org_id, _role = ctx

    summary = await build_summary(db, org_id, user_id=user.id)
    daily = await daily_activity(db, org_id, user_id=user.id, days=days)
    sources = await top_sources(db, org_id, user_id=user.id)
    recent = await recent_questions(db, org_id, user_id=user.id, limit=10)

    return PersonalAnalyticsOut(
        summary=summary,
        daily=daily,
        top_sources=sources,
        recent_questions=recent,
    )
