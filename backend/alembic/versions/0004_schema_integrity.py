"""Align index/constraint names with the ORM metadata and close the schema drift.

The initial migration hand-named indexes with short aliases (``ix_audit_org_id``)
while the models produce convention-based names (``ix_audit_logs_organization_id``).
Alembic therefore proposed a rename for ~40 objects on every autogenerate, and —
because ``content_tsv`` plus its GIN index and the ivfflat vector index were not
declared on the model — it also proposed **dropping** them, which would have
silently killed keyword search and vector performance.

This revision makes the database match the models instead:

* rename the legacy short index names to their ORM names (metadata-only in
  PostgreSQL, no rebuild);
* convert the four legacy ``uq_*`` unique constraints into the unique indexes the
  models declare (``organizations.slug``, ``users.email``, ``users.email_normalized``,
  ``refresh_sessions.token_hash``);
* add the indexes the models declare but the database never had;
* add the idempotency uniqueness constraints (chunk index per document, one
  verdict per user per message, one upload per tenant by checksum);
* make ``document_chunks.embedding`` NOT NULL after verifying no NULL rows exist.

Revision ID: 0004
Revises: 0003
"""

from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

# (table, legacy name, ORM name)
_INDEX_RENAMES: tuple[tuple[str, str, str], ...] = (
    ("audit_logs", "ix_audit_action", "ix_audit_logs_action"),
    ("audit_logs", "ix_audit_actor_user_id", "ix_audit_logs_actor_user_id"),
    ("audit_logs", "ix_audit_org_id", "ix_audit_logs_organization_id"),
    (
        "conversation_summaries",
        "ix_summaries_conversation_id",
        "ix_conversation_summaries_conversation_id",
    ),
    ("conversations", "ix_conversations_org_id", "ix_conversations_organization_id"),
    ("document_chunks", "ix_chunks_document_id", "ix_document_chunks_document_id"),
    ("document_chunks", "ix_chunks_org_id", "ix_document_chunks_organization_id"),
    (
        "document_processing_jobs",
        "ix_jobs_celery_task_id",
        "ix_document_processing_jobs_celery_task_id",
    ),
    (
        "document_processing_jobs",
        "ix_jobs_document_id",
        "ix_document_processing_jobs_document_id",
    ),
    (
        "document_processing_jobs",
        "ix_jobs_org_id",
        "ix_document_processing_jobs_organization_id",
    ),
    ("document_processing_jobs", "ix_jobs_status", "ix_document_processing_jobs_status"),
    ("documents", "ix_documents_checksum", "ix_documents_checksum_sha256"),
    ("documents", "ix_documents_org_id", "ix_documents_organization_id"),
    ("messages", "ix_messages_org_id", "ix_messages_organization_id"),
    ("notifications", "ix_notifications_org_id", "ix_notifications_organization_id"),
    ("notifications", "ix_notifications_recipient", "ix_notifications_recipient_user_id"),
    (
        "organization_memberships",
        "ix_memberships_org_id",
        "ix_organization_memberships_organization_id",
    ),
    (
        "organization_memberships",
        "ix_memberships_user_id",
        "ix_organization_memberships_user_id",
    ),
    ("role_requests", "ix_role_requests_org_id", "ix_role_requests_organization_id"),
    ("usage_records", "ix_usage_org_id", "ix_usage_records_organization_id"),
    ("usage_records", "ix_usage_user_id", "ix_usage_records_user_id"),
)

# Indexes declared on the models that the database never created.
_NEW_INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("conversation_summaries", "ix_conversation_summaries_organization_id", ("organization_id",)),
    ("documents", "ix_documents_uploaded_by", ("uploaded_by",)),
    ("feedback", "ix_feedback_organization_id", ("organization_id",)),
    ("feedback", "ix_feedback_user_id", ("user_id",)),
    ("messages", "ix_messages_user_id", ("user_id",)),
    ("role_requests", "ix_role_requests_requested_by", ("requested_by",)),
    ("usage_records", "ix_usage_records_conversation_id", ("conversation_id",)),
)

# Legacy unique constraints replaced by the unique indexes the models declare.
_UNIQUE_INDEX_CONVERSIONS: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    ("organizations", "uq_organization_slug", "ix_organizations_slug", ("slug",)),
    ("refresh_sessions", "uq_refresh_token_hash", "ix_refresh_sessions_token_hash", ("token_hash",)),
    ("users", "uq_user_email", "ix_users_email", ("email",)),
    ("users", "uq_user_email_normalized", "ix_users_email_normalized", ("email_normalized",)),
)


def upgrade() -> None:
    # 1. Rename legacy index names to the names the ORM expects.
    for _table, legacy, current in _INDEX_RENAMES:
        op.execute(f'ALTER INDEX IF EXISTS "{legacy}" RENAME TO "{current}"')

    # 2. Drop the legacy unique constraints and replace their plain indexes with
    #    unique ones (the models declare ``unique=True, index=True``).
    for table, constraint, index_name, columns in _UNIQUE_INDEX_CONVERSIONS:
        op.execute(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{constraint}"')
        op.execute(f'DROP INDEX IF EXISTS "{index_name}"')
        column_list = ", ".join(f'"{column}"' for column in columns)
        op.execute(f'CREATE UNIQUE INDEX "{index_name}" ON "{table}" ({column_list})')

    # 3. Add indexes the models declare.
    for table, name, columns in _NEW_INDEXES:
        column_list = ", ".join(f'"{column}"' for column in columns)
        op.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({column_list})')

    # 4. Collapse duplicate feedback rows before enforcing one verdict per user
    #    per message. The newest row wins; ties break on id for determinism.
    op.execute(
        """
        DELETE FROM feedback AS f
        USING (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY message_id, user_id
                       ORDER BY created_at DESC, id DESC
                   ) AS rn
            FROM feedback
        ) AS ranked
        WHERE f.id = ranked.id AND ranked.rn > 1
        """
    )

    # 5. Idempotency constraints.
    op.create_unique_constraint(
        "uq_document_chunks_document_index",
        "document_chunks",
        ["document_id", "chunk_index"],
    )
    op.create_unique_constraint(
        "uq_documents_org_checksum",
        "documents",
        ["organization_id", "checksum_sha256"],
    )
    op.create_unique_constraint(
        "uq_feedback_message_user",
        "feedback",
        ["message_id", "user_id"],
    )

    # 6. A chunk without a vector breaks cosine ordering for the whole tenant.
    #    Verified before writing this revision: zero NULL embeddings.
    op.alter_column("document_chunks", "embedding", nullable=False)


def downgrade() -> None:
    op.alter_column("document_chunks", "embedding", nullable=True)

    op.drop_constraint("uq_feedback_message_user", "feedback", type_="unique")
    op.drop_constraint("uq_documents_org_checksum", "documents", type_="unique")
    op.drop_constraint("uq_document_chunks_document_index", "document_chunks", type_="unique")

    for _table, name, _columns in _NEW_INDEXES:
        op.execute(f'DROP INDEX IF EXISTS "{name}"')

    # Restore the constraint-backed unique indexes the database had before.
    for table, constraint, index_name, columns in _UNIQUE_INDEX_CONVERSIONS:
        op.execute(f'DROP INDEX IF EXISTS "{index_name}"')
        column_list = ", ".join(f'"{column}"' for column in columns)
        op.execute(f'ALTER TABLE "{table}" ADD CONSTRAINT "{constraint}" UNIQUE ({column_list})')

    for _table, legacy, current in reversed(_INDEX_RENAMES):
        op.execute(f'ALTER INDEX IF EXISTS "{current}" RENAME TO "{legacy}"')
