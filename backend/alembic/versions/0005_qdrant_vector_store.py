"""Move embeddings out of PostgreSQL into Qdrant.

Embeddings are no longer stored in ``document_chunks.embedding``: they live in
the Qdrant collection configured by ``QDRANT_COLLECTION``, keyed by chunk UUID.
This revision drops the legacy vector column, its IVFFlat index and, where
possible, the now-unused ``vector`` extension. All statements are guarded so a
fresh install (where 0001 no longer created these objects) upgrades cleanly.

Downgrade recreates the column and index but cannot restore the vectors that
were removed — documents must be reindexed against the old backend.

Revision ID: 0005
Revises: 0004
"""

from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding_ivfflat")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding")

    # Dropping the extension can be restricted by managed Postgres providers;
    # nothing depends on it once the column and index are gone, so a failure
    # here is harmless and must not block the migration.
    op.execute("""
        DO $$
        BEGIN
            DROP EXTENSION IF EXISTS vector;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'could not drop vector extension: %', SQLERRM;
        END
        $$
    """)


def downgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        ALTER TABLE document_chunks
        ADD COLUMN IF NOT EXISTS embedding vector(384)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_chunks_embedding_ivfflat
        ON document_chunks
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    """)
