"""Organization admin overview endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import OrgAdminUser
from app.db.models.audit import Notification, RoleRequest, RoleRequestStatus, UsageRecord
from app.db.models.conversation import Conversation, Feedback, Message, MessageRole
from app.db.models.document import Document, DocumentProcessingJob, JobStatus
from app.db.models.user import OrganizationMembership, OrgRole, User
from app.db.session import get_db
from app.schemas.workflow import FeedbackReviewUpdate, ReviewDecision

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
async def organization_overview(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> dict:
    """Return live, tenant-scoped dashboard metrics and recent members."""
    _user, org_id, _role = ctx

    total_users = await db.scalar(
        select(func.count(OrganizationMembership.id)).where(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.is_active == True,  # noqa: E712
        )
    )
    total_documents = await db.scalar(
        select(func.count(Document.id)).where(
            Document.organization_id == org_id,
            Document.is_active == True,  # noqa: E712
        )
    )
    total_conversations = await db.scalar(
        select(func.count(Conversation.id)).where(
            Conversation.organization_id == org_id,
            Conversation.is_active == True,  # noqa: E712
        )
    )
    total_questions = await db.scalar(
        select(func.count(Message.id)).where(
            Message.organization_id == org_id,
            Message.role == MessageRole.USER,
        )
    )
    total_tokens_used = await db.scalar(
        select(func.coalesce(func.sum(UsageRecord.total_tokens), 0)).where(
            UsageRecord.organization_id == org_id,
        )
    )

    rows = await db.execute(
        select(User, OrganizationMembership)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
        .where(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.is_active == True,  # noqa: E712
        )
        .order_by(OrganizationMembership.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    users = []
    for member, membership in rows.all():
        is_admin = member.is_platform_admin or membership.role == OrgRole.ORG_ADMIN
        users.append(
            {
                "id": str(member.id),
                "full_name": member.full_name,
                "email": member.email,
                "role": "admin" if is_admin else "member",
                "created_at": membership.created_at.isoformat(),
            }
        )

    failed_job_rows = await db.execute(
        select(DocumentProcessingJob, Document.title)
        .join(Document, Document.id == DocumentProcessingJob.document_id)
        .where(
            DocumentProcessingJob.organization_id == org_id,
            DocumentProcessingJob.status.in_([JobStatus.FAILED, JobStatus.DEAD]),
        )
        .order_by(DocumentProcessingJob.updated_at.desc())
        .limit(10)
    )
    failed_jobs = [
        {
            "id": str(job.id),
            "document_id": str(job.document_id),
            "document_title": title,
            "status": job.status.value,
            "error_message": job.error_message,
            "updated_at": job.updated_at.isoformat(),
        }
        for job, title in failed_job_rows.all()
    ]

    return {
        "total_users": total_users or 0,
        "total_documents": total_documents or 0,
        "total_conversations": total_conversations or 0,
        "total_questions": int(total_questions or 0),
        "total_tokens_used": int(total_tokens_used or 0),
        "users": users,
        "users_page": page,
        "users_page_size": page_size,
        "failed_jobs": failed_jobs,
    }


@router.get("/members")
async def list_members(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=255),
) -> dict:
    """Paginated, searchable list of organization members."""
    _admin, org_id, _role = ctx

    base = (
        select(User, OrganizationMembership)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
        .where(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.is_active == True,  # noqa: E712
        )
    )
    if search:
        term = f"%{search.lower()}%"
        from sqlalchemy import or_

        base = base.where(or_(User.full_name.ilike(term), User.email_normalized.ilike(term)))

    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    rows = await db.execute(
        base.order_by(OrganizationMembership.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = []
    for member, membership in rows.all():
        is_admin = member.is_platform_admin or membership.role == OrgRole.ORG_ADMIN
        items.append(
            {
                "id": str(member.id),
                "full_name": member.full_name,
                "email": member.email,
                "role": "admin" if is_admin else "member",
                "status": member.status.value,
                "joined_at": membership.created_at.isoformat(),
            }
        )
    return {"items": items, "total": total or 0, "page": page, "page_size": page_size}


@router.get("/feedback")
async def list_feedback(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(default=None, pattern="^(open|in_review|solved)$"),
) -> dict:
    _admin, org_id, _role = ctx
    base = (
        select(Feedback, User.full_name, User.email, Message.content)
        .join(User, User.id == Feedback.user_id)
        .join(Message, Message.id == Feedback.message_id)
        .where(Feedback.organization_id == org_id)
    )
    if status:
        base = base.where(Feedback.review_status == status)
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    rows = await db.execute(
        base.order_by(Feedback.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return {
        "items": [
            {
                "id": str(item.id),
                "feedback_type": item.feedback_type.value,
                "comment": item.comment,
                "review_status": item.review_status,
                "admin_note": item.admin_note,
                "user_name": name,
                "user_email": email,
                "message_excerpt": message[:240],
                "created_at": item.created_at.isoformat(),
            }
            for item, name, email, message in rows.all()
        ],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/feedback/{feedback_id}")
async def review_feedback(
    feedback_id: str,
    body: FeedbackReviewUpdate,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    admin, org_id, _role = ctx
    item = await db.scalar(
        select(Feedback).where(Feedback.id == feedback_id, Feedback.organization_id == org_id)
    )
    if item is None:
        from app.core.exceptions import PermissionDeniedError

        raise PermissionDeniedError("Feedback not found.")
    item.review_status = body.status
    item.admin_note = body.note
    item.reviewed_by = admin.id
    item.reviewed_at = datetime.now(timezone.utc)
    db.add(
        Notification(
            organization_id=org_id,
            recipient_user_id=item.user_id,
            notification_type="feedback_update",
            title="Your feedback was updated",
            body="Your feedback is being reviewed."
            if body.status == "in_review"
            else "Your feedback was marked as solved.",
            link="/chat",
        )
    )
    await db.commit()
    return {"status": body.status}


@router.get("/access-requests")
async def list_access_requests(
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$"),
) -> dict:
    _admin, org_id, _role = ctx
    base = (
        select(RoleRequest, User.full_name, User.email)
        .join(User, User.id == RoleRequest.requested_by)
        .where(RoleRequest.organization_id == org_id)
    )
    if status:
        base = base.where(RoleRequest.status == RoleRequestStatus(status))
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    rows = await db.execute(
        base.order_by(RoleRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return {
        "items": [
            {
                "id": str(request.id),
                "user_name": name,
                "user_email": email,
                "reason": request.reason,
                "status": request.status.value,
                "created_at": request.created_at.isoformat(),
            }
            for request, name, email in rows.all()
        ],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/access-requests/{request_id}")
async def decide_access_request(
    request_id: str,
    body: ReviewDecision,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    admin, org_id, _role = ctx
    request = await db.scalar(
        select(RoleRequest).where(
            RoleRequest.id == request_id, RoleRequest.organization_id == org_id
        )
    )
    if request is None or request.status != RoleRequestStatus.PENDING:
        from app.core.exceptions import PermissionDeniedError

        raise PermissionDeniedError("Access request is not available for review.")
    request.status = RoleRequestStatus(body.status)
    request.reviewed_by = admin.id
    request.reviewer_note = body.note
    if request.status == RoleRequestStatus.APPROVED:
        membership = await db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == org_id,
                OrganizationMembership.user_id == request.requested_by,
                OrganizationMembership.is_active == True,  # noqa: E712
            )
        )
        if membership:
            membership.role = OrgRole.ORG_ADMIN
    db.add(
        Notification(
            organization_id=org_id,
            recipient_user_id=request.requested_by,
            notification_type="access_request_decision",
            title="Administrator access request "
            + ("approved" if request.status == RoleRequestStatus.APPROVED else "rejected"),
            body=body.note
            or (
                "You now have organization-admin access."
                if request.status == RoleRequestStatus.APPROVED
                else "An administrator did not approve the request."
            ),
            link="/chat",
        )
    )
    await db.commit()
    return {"status": request.status.value}
