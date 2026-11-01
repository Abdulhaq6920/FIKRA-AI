"""
Organization model — top-level tenant boundary.

Every resource in the system belongs to exactly one organization.
"""

from __future__ import annotations

import enum

from sqlalchemy import Boolean, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin

# Helper: tell SQLAlchemy to store enum .value (lowercase) not .name (uppercase)
_vc = lambda x: [e.value for e in x]  # noqa: E731


class OrganizationStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class Organization(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[OrganizationStatus] = mapped_column(
        Enum(OrganizationStatus, name="organization_status", values_callable=_vc),
        default=OrganizationStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    allow_registration: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_users: Mapped[int] = mapped_column(default=100, nullable=False)
    max_documents: Mapped[int] = mapped_column(default=1000, nullable=False)
    max_storage_mb: Mapped[int] = mapped_column(default=5000, nullable=False)

    # Relationships
    memberships: Mapped[list["OrganizationMembership"]] = relationship(  # noqa: F821
        "OrganizationMembership", back_populates="organization", cascade="all, delete-orphan"
    )
    documents: Mapped[list["Document"]] = relationship(  # noqa: F821
        "Document", back_populates="organization", cascade="all, delete-orphan"
    )
    conversations: Mapped[list["Conversation"]] = relationship(  # noqa: F821
        "Conversation", back_populates="organization", cascade="all, delete-orphan"
    )
    usage_records: Mapped[list["UsageRecord"]] = relationship(  # noqa: F821
        "UsageRecord", back_populates="organization", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(  # noqa: F821
        "AuditLog", back_populates="organization", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Organization id={self.id} slug={self.slug}>"
