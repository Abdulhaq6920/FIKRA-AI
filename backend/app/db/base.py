"""
SQLAlchemy declarative base and shared column mixins.

All models import Base from here.
Never use Base.metadata.create_all() for production schema management —
use Alembic migrations instead.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Alembic compares index names on every `alembic check`; pin the pattern so new
# indexes are stable and autogenerate cannot invent a different naming scheme.
# Only the ``ix`` template is pinned — primary-key/foreign-key/unique constraint
# names are set explicitly where they matter, so they are left untouched.
_NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""

    metadata = MetaData(naming_convention=_NAMING_CONVENTION)


class UUIDMixin:
    """Provide a UUID primary key column named 'id'."""

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    """Provide created_at and updated_at columns (UTC)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        server_default=func.now(),
        onupdate=_utcnow,
        nullable=False,
    )


class SoftDeleteMixin:
    """
    Optional soft-delete support.

    Repositories MUST filter on deleted_at IS NULL unless the
    operation explicitly requires seeing deleted records.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
