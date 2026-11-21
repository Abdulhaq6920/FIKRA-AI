"""Re-embed existing document chunks into Qdrant.

Run this after migrating to the Qdrant backend (migration 0005). The legacy
``document_chunks.embedding`` column is gone by then, so vectors are recomputed
from the stored chunk text with the configured embedding model.

Usage (from ``backend/``)::

    ..\\.venv\\Scripts\\python.exe scripts\\backfill_qdrant.py

The script is idempotent: Qdrant point IDs are chunk UUIDs, so re-running it
overwrites the same points. Chunk text and organization IDs come from the
relational rows, keeping every point tenant-scoped.
"""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import select

from app.core.logging import configure_logging, get_logger
from app.db.models.document import DocumentChunk
from app.db.session import AsyncSessionLocal
from app.providers.embeddings import embed_documents
from app.providers.vector_store import (
    VectorPoint,
    close_qdrant_client,
    ensure_collection,
    upsert_points,
)

configure_logging()
logger = get_logger(__name__)

_BATCH_SIZE = 100


async def main() -> None:
    """Embed every chunk in batches and upsert it into Qdrant."""
    await ensure_collection()
    last_id: uuid.UUID | None = None
    total = 0

    try:
        while True:
            async with AsyncSessionLocal() as db:
                stmt = (
                    select(
                        DocumentChunk.id,
                        DocumentChunk.document_id,
                        DocumentChunk.organization_id,
                        DocumentChunk.content,
                    )
                    .order_by(DocumentChunk.id)
                    .limit(_BATCH_SIZE)
                )
                if last_id is not None:
                    stmt = stmt.where(DocumentChunk.id > last_id)
                rows = (await db.execute(stmt)).all()

            if not rows:
                break

            texts = [row.content for row in rows]
            embeddings = await asyncio.to_thread(embed_documents, texts)
            points = [
                VectorPoint(
                    chunk_id=row.id,
                    document_id=row.document_id,
                    organization_id=row.organization_id,
                    embedding=embedding,
                )
                for row, embedding in zip(rows, embeddings, strict=True)
            ]
            await upsert_points(points)

            total += len(points)
            last_id = rows[-1].id
            logger.info("backfill_progress", chunks=total)

        logger.info("backfill_complete", chunks=total)
    finally:
        await close_qdrant_client()


if __name__ == "__main__":
    asyncio.run(main())
