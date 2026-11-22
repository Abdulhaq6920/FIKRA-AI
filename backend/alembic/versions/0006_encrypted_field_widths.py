"""Widen columns that now hold Fernet ciphertext.

Sensitive fields (users.email, users.full_name, documents.title,
documents.original_filename, conversations.title, favorite_questions.question)
are encrypted at rest with Fernet. A Fernet token is roughly 1.5x the
plaintext length, so the original column widths would truncate ciphertext.

This revision widens only the encrypted columns to 1024 characters. The
``users.email_normalized`` lookup column stays at 320 (it is never
encrypted, so login can query it directly).

Revision ID: 0006
Revises: 0005
"""

from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# (table, column, old_length, new_length)
_WIDEN: tuple[tuple[str, str, int, int], ...] = (
    ("users", "email", 320, 1024),
    ("users", "full_name", 255, 1024),
    ("documents", "title", 512, 1024),
    ("documents", "original_filename", 512, 1024),
    ("conversations", "title", 512, 1024),
    ("favorite_questions", "question", 500, 1024),
)


def upgrade() -> None:
    for table, column, _old_length, new_length in _WIDEN:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f"TYPE varchar({new_length}) USING {column}::varchar({new_length})"
        )


def downgrade() -> None:
    # Downgrading would truncate any ciphertext longer than the old width,
    # which cannot be reversed. Refuse rather than silently corrupt data.
    raise RuntimeError(
        "Downgrade from 0006 is not supported: widening encrypted columns is "
        "not reversible without the original plaintext."
    )
