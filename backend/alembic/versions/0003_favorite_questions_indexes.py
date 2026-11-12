"""Per-user favourite questions and chat/query hot-path indexes.

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "favorite_questions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "user_id",
            "question",
            name="uq_favorite_questions_owner_question",
        ),
    )
    op.create_index(
        "ix_favorite_questions_owner_created",
        "favorite_questions",
        ["organization_id", "user_id", "created_at"],
    )

    op.execute(
        """
        CREATE TRIGGER trigger_favorite_questions_updated_at
        BEFORE UPDATE ON favorite_questions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        """
    )

    # Hot-path composite indexes. Each mirrors an actual WHERE/ORDER BY in the
    # API so PostgreSQL can satisfy the filter and ordering from one index.
    op.create_index(
        "ix_conversations_owner_active_updated",
        "conversations",
        ["organization_id", "user_id", "is_active", "updated_at"],
    )
    op.create_index(
        "ix_messages_conversation_created",
        "messages",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        "ix_notifications_recipient_read_created",
        "notifications",
        ["recipient_user_id", "is_read", "created_at"],
    )
    op.create_index(
        "ix_feedback_org_status_created",
        "feedback",
        ["organization_id", "review_status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_feedback_org_status_created", table_name="feedback")
    op.drop_index("ix_notifications_recipient_read_created", table_name="notifications")
    op.drop_index("ix_messages_conversation_created", table_name="messages")
    op.drop_index("ix_conversations_owner_active_updated", table_name="conversations")
    op.execute("DROP TRIGGER IF EXISTS trigger_favorite_questions_updated_at ON favorite_questions")
    op.drop_index("ix_favorite_questions_owner_created", table_name="favorite_questions")
    op.drop_table("favorite_questions")
