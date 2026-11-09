"""Organization-admin access request workflow."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.exceptions import ConflictError, PermissionDeniedError
from app.db.models.audit import Notification, RoleRequest, RoleRequestStatus
from app.db.models.user import OrgRole, OrganizationMembership
from app.db.session import get_db
from app.schemas.workflow import RoleRequestCreate

router = APIRouter(prefix="/access-requests", tags=["access requests"])


@router.post("", status_code=201)
async def request_org_admin_access(
    body: RoleRequestCreate,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    user, org_id, role = ctx
    if user.is_platform_admin or role == OrgRole.ORG_ADMIN.value:
        raise ConflictError("You already have administrator access.")
    pending = await db.scalar(
        select(RoleRequest).where(
            RoleRequest.organization_id == org_id,
            RoleRequest.requested_by == user.id,
            RoleRequest.status == RoleRequestStatus.PENDING,
        )
    )
    if pending:
        raise ConflictError("You already have an access request awaiting review.")

    request = RoleRequest(organization_id=org_id, requested_by=user.id, reason=body.reason)
    db.add(request)
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
                notification_type="access_request",
                title="Administrator access request",
                body=f"{user.full_name} requested organization-admin access.",
                link="/admin",
            )
        )
    await db.commit()
    return {"status": "pending"}
