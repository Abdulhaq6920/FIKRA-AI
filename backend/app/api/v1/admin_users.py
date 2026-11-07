"""Organization user-management endpoints for admins.

All operations are scoped to the caller's organization (from the signed JWT).
Guards:
- cannot change your own role or deactivate yourself;
- at least one active organization admin must remain;
- an organization admin cannot modify a platform admin;
- password changes revoke active refresh sessions.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import OrgAdminUser
from app.core.exceptions import (
    ConflictError,
    EmailAlreadyExistsError,
    PermissionDeniedError,
    UserNotFoundError,
)
from app.core.security import hash_password
from app.db.models.audit import AuditLog
from app.db.models.user import (
    OrganizationMembership,
    OrgRole,
    RefreshSession,
    User,
    UserStatus,
)
from app.db.session import get_db
from app.schemas.user_admin import (
    AdminPasswordReset,
    AdminRole,
    AdminUserCreate,
    AdminUserListResponse,
    AdminUserOut,
    AdminUserUpdate,
)

router = APIRouter(prefix="/admin/users", tags=["admin"])


def _api_role(user: User, membership: OrganizationMembership) -> AdminRole:
    if user.is_platform_admin or membership.role == OrgRole.ORG_ADMIN:
        return "admin"
    return "member"


def _to_out(user: User, membership: OrganizationMembership, actor_id: uuid.UUID) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=_api_role(user, membership),
        is_active=membership.is_active,
        account_status=user.status.value,
        is_platform_admin=user.is_platform_admin,
        joined_at=membership.created_at,
        is_self=user.id == actor_id,
    )


async def _get_member(
    db: AsyncSession, organization_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[User, OrganizationMembership]:
    """Load a user + membership inside the caller's organization."""
    row = (
        await db.execute(
            select(User, OrganizationMembership)
            .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
            .where(
                User.id == user_id,
                OrganizationMembership.organization_id == organization_id,
            )
        )
    ).first()
    if row is None:
        raise UserNotFoundError()
    return row[0], row[1]


async def _other_active_admins(
    db: AsyncSession, organization_id: uuid.UUID, exclude_user_id: uuid.UUID
) -> int:
    return int(
        await db.scalar(
            select(func.count(OrganizationMembership.id)).where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.role == OrgRole.ORG_ADMIN,
                OrganizationMembership.is_active == True,  # noqa: E712
                OrganizationMembership.user_id != exclude_user_id,
            )
        )
        or 0
    )


async def _revoke_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user_id, RefreshSession.is_revoked == False)  # noqa: E712
        .values(is_revoked=True)
    )


def _audit(
    db: AsyncSession,
    request: Request,
    organization_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    target: User,
    details: dict,
) -> None:
    """Record a privileged change. Never store passwords or tokens."""
    db.add(
        AuditLog(
            organization_id=organization_id,
            actor_user_id=actor_id,
            action=action,
            resource_type="user",
            resource_id=str(target.id),
            details=details,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, "request_id", None),
        )
    )


@router.get("", response_model=AdminUserListResponse)
async def list_users(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=255),
    role: Literal["admin", "member"] | None = Query(default=None),
    is_active: bool | None = Query(default=None),
) -> AdminUserListResponse:
    """Paginated, searchable list of all users in the caller's organization."""
    actor, org_id, _role = ctx

    base = (
        select(User, OrganizationMembership)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
        .where(OrganizationMembership.organization_id == org_id)
    )
    if search:
        term = f"%{search.strip().lower()}%"
        base = base.where(
            or_(User.full_name.ilike(term), User.email_normalized.ilike(term))
        )
    if role == "admin":
        base = base.where(
            or_(
                OrganizationMembership.role == OrgRole.ORG_ADMIN,
                User.is_platform_admin == True,  # noqa: E712
            )
        )
    elif role == "member":
        base = base.where(
            and_(
                OrganizationMembership.role == OrgRole.MEMBER,
                User.is_platform_admin == False,  # noqa: E712
            )
        )
    if is_active is not None:
        base = base.where(OrganizationMembership.is_active == is_active)

    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = await db.execute(
        base.order_by(OrganizationMembership.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [_to_out(user, membership, actor.id) for user, membership in rows.all()]
    return AdminUserListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


@router.post("", response_model=AdminUserOut, status_code=201)
async def create_user(
    body: AdminUserCreate,
    request: Request,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    """Create an active user inside the caller's organization."""
    actor, org_id, _role = ctx
    email_normalized = body.email.strip().lower()

    existing = await db.scalar(
        select(User.id).where(User.email_normalized == email_normalized)
    )
    if existing is not None:
        raise EmailAlreadyExistsError()

    user = User(
        email=body.email.strip(),
        email_normalized=email_normalized,
        hashed_password=hash_password(body.password),
        full_name=body.full_name.strip(),
        status=UserStatus.ACTIVE,
        is_platform_admin=False,
    )
    db.add(user)
    await db.flush()

    membership = OrganizationMembership(
        user_id=user.id,
        organization_id=org_id,
        role=OrgRole.ORG_ADMIN if body.role == "admin" else OrgRole.MEMBER,
        is_active=True,
    )
    db.add(membership)
    await db.flush()

    _audit(
        db,
        request,
        org_id,
        actor.id,
        "user.created",
        user,
        {"role": body.role, "is_active": True},
    )
    await db.flush()
    return _to_out(user, membership, actor.id)


@router.patch("/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    request: Request,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    """Update a member's name, organization role, or active state."""
    actor, org_id, _role = ctx
    user, membership = await _get_member(db, org_id, user_id)

    if user.is_platform_admin and not actor.is_platform_admin:
        raise PermissionDeniedError(
            "Platform administrators can only be managed by platform admins."
        )

    is_self = user.id == actor.id
    if is_self and body.role is not None and body.role != _api_role(user, membership):
        raise PermissionDeniedError("You cannot change your own role.")
    if is_self and body.is_active is False:
        raise PermissionDeniedError("You cannot deactivate your own account.")

    removing_admin = _api_role(user, membership) == "admin" and (
        body.role == "member" or body.is_active is False
    )
    if removing_admin and membership.is_active:
        if await _other_active_admins(db, org_id, user.id) == 0:
            raise ConflictError("At least one active organization admin is required.")

    changes: dict[str, object] = {}
    if body.full_name is not None and body.full_name.strip() != user.full_name:
        user.full_name = body.full_name.strip()
        changes["full_name"] = user.full_name
    if body.role is not None:
        new_role = OrgRole.ORG_ADMIN if body.role == "admin" else OrgRole.MEMBER
        if membership.role != new_role:
            membership.role = new_role
            changes["role"] = body.role
    if body.is_active is not None and membership.is_active != body.is_active:
        membership.is_active = body.is_active
        user.status = UserStatus.ACTIVE if body.is_active else UserStatus.DISABLED
        changes["is_active"] = body.is_active
        if not body.is_active:
            await _revoke_sessions(db, user.id)

    if changes:
        _audit(db, request, org_id, actor.id, "user.updated", user, changes)
        await db.flush()

    return _to_out(user, membership, actor.id)


@router.post("/{user_id}/reset-password", status_code=204, response_model=None)
async def reset_user_password(
    user_id: uuid.UUID,
    body: AdminPasswordReset,
    request: Request,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Set a new password for a member and revoke their active sessions."""
    actor, org_id, _role = ctx
    user, _membership = await _get_member(db, org_id, user_id)

    if user.is_platform_admin and not actor.is_platform_admin:
        raise PermissionDeniedError(
            "Platform administrators can only be managed by platform admins."
        )

    user.hashed_password = hash_password(body.new_password)
    await _revoke_sessions(db, user.id)
    _audit(db, request, org_id, actor.id, "user.password_reset", user, {})
    await db.flush()
