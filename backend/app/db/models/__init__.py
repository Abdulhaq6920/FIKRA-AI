"""
Import all models here so Alembic can discover them automatically.
"""

from app.db.models.audit import AuditLog, Notification, RoleRequest, RoleRequestStatus, UsageRecord
from app.db.models.conversation import (
    Conversation,
    ConversationSummary,
    Feedback,
    FeedbackType,
    Message,
    MessageRole,
)
from app.db.models.document import (
    Document,
    DocumentAccessLevel,
    DocumentChunk,
    DocumentProcessingJob,
    DocumentStatus,
    JobStatus,
)
from app.db.models.organization import Organization, OrganizationStatus
from app.db.models.user import (
    OrgRole,
    OrganizationMembership,
    RefreshSession,
    User,
    UserStatus,
)

__all__ = [
    "Organization",
    "OrganizationStatus",
    "User",
    "UserStatus",
    "OrgRole",
    "OrganizationMembership",
    "RefreshSession",
    "Document",
    "DocumentStatus",
    "DocumentAccessLevel",
    "DocumentChunk",
    "DocumentProcessingJob",
    "JobStatus",
    "Conversation",
    "Message",
    "MessageRole",
    "ConversationSummary",
    "Feedback",
    "FeedbackType",
    "AuditLog",
    "UsageRecord",
    "Notification",
    "RoleRequest",
    "RoleRequestStatus",
]
