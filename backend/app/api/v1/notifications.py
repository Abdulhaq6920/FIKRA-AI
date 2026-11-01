"""In-app notifications for the authenticated organization member."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.exceptions import PermissionDeniedError
from app.db.models.audit import Notification
from app.db.session import get_db
from app.schemas.workflow import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> dict:
    user, org_id, _role = ctx
    base = select(Notification).where(
        Notification.organization_id == org_id,
        Notification.recipient_user_id == user.id,
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    rows = await db.execute(base.order_by(Notification.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    unread = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.organization_id == org_id,
            Notification.recipient_user_id == user.id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    return {
        "items": [NotificationOut.model_validate(row) for row in rows.scalars().all()],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
        "unread": unread or 0,
    }


@router.patch("/{notification_id}/read", status_code=204)
async def mark_read(
    notification_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    user, org_id, _role = ctx
    item = await db.scalar(select(Notification).where(
        Notification.id == notification_id,
        Notification.organization_id == org_id,
        Notification.recipient_user_id == user.id,
    ))
    if item is None:
        raise PermissionDeniedError("Notification not found.")
    item.is_read = True
    await db.commit()
