"""
Qdrant vector store provider.

Embeddings live in Qdrant; PostgreSQL keeps the relational chunk rows (including
the full-text ``content_tsv`` column). A Qdrant point ID is the chunk's UUID, so
a vector hit can be joined back to its tenant-scoped relational row.

Tenant isolation is enforced at two levels:

1. Every Qdrant query carries an ``organization_id`` payload filter — it is a
   server-side pre-filter, never a client-side post-filter.
2. Retrieval re-checks ``organization_id``, document status and access level in
   PostgreSQL when it resolves the returned chunk IDs.

The client is created once per process and reused by both the API and the
Celery worker.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

from qdrant_client import AsyncQdrantClient, models

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class VectorPoint:
    """One chunk embedding to upsert into Qdrant."""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    organization_id: uuid.UUID
    # Optional at the type boundary because chunking produces unembedded data;
    # upsert_points() rejects None so an unembedded chunk is never indexed.
    embedding: list[float] | None


@dataclass(frozen=True, slots=True)
class VectorHit:
    """A vector search result: the chunk UUID and its cosine similarity."""

    chunk_id: uuid.UUID
    score: float


@lru_cache(maxsize=1)
def get_qdrant_client() -> AsyncQdrantClient:
    """Return the process-wide async Qdrant client."""
    return AsyncQdrantClient(
        url=str(settings.qdrant_url),
        api_key=settings.qdrant_api_key or None,
        timeout=settings.qdrant_timeout,
    )


def build_tenant_filter(
    organization_id: uuid.UUID,
    *,
    document_ids: Iterable[uuid.UUID] | None = None,
) -> models.Filter:
    """Build a mandatory tenant (and optional document) payload filter.

    Kept as a pure function so tenant-isolation tests can inspect the exact
    filter that Qdrant will apply without making a network call.
    """
    must: list[models.Condition] = [
        models.FieldCondition(
            key="organization_id",
            match=models.MatchValue(value=str(organization_id)),
        )
    ]
    if document_ids is not None:
        ids = [str(document_id) for document_id in document_ids]
        if not ids:
            # A MatchAny with an empty list matches nothing — keep the filter
            # valid but guaranteed empty instead of dropping the tenant term.
            ids = ["00000000-0000-0000-0000-000000000000"]
        must.append(
            models.FieldCondition(
                key="document_id",
                match=models.MatchAny(any=ids),
            )
        )
    return models.Filter(must=must)


async def ensure_collection() -> None:
    """Create the collection and its payload indexes when they do not exist."""
    client = get_qdrant_client()
    name = settings.qdrant_collection
    if not await client.collection_exists(name):
        await client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=settings.embedding_dimensions,
                distance=models.Distance.COSINE,
            ),
        )
        logger.info(
            "qdrant_collection_created",
            collection=name,
            dimensions=settings.embedding_dimensions,
        )

    # Payload indexes make tenant/document pre-filtering fast at scale. These
    # calls are idempotent, so they are safe on every startup.
    for field in ("organization_id", "document_id"):
        await client.create_payload_index(
            collection_name=name,
            field_name=field,
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
    logger.info("qdrant_collection_ready", collection=name)


async def ping() -> None:
    """Verify the Qdrant cluster is reachable. Raises on failure."""
    await get_qdrant_client().get_collections()


async def drop_collection() -> None:
    """Delete the vector collection (used when changing embedding dimensions)."""
    await get_qdrant_client().delete_collection(settings.qdrant_collection)
    logger.warning("qdrant_collection_dropped", collection=settings.qdrant_collection)


async def close_qdrant_client() -> None:
    """Close the shared client and clear the cache so a restart can recreate it."""
    await get_qdrant_client().close()
    get_qdrant_client.cache_clear()


async def upsert_points(points: list[VectorPoint]) -> None:
    """Write chunk embeddings to Qdrant (idempotent: point ID = chunk ID)."""
    if not points:
        return

    qdrant_points: list[models.PointStruct] = []
    for point in points:
        if point.embedding is None:
            raise ValueError("cannot index a chunk without an embedding")
        qdrant_points.append(
            models.PointStruct(
                id=str(point.chunk_id),
                vector=point.embedding,
                payload={
                    "chunk_id": str(point.chunk_id),
                    "document_id": str(point.document_id),
                    "organization_id": str(point.organization_id),
                },
            )
        )

    await get_qdrant_client().upsert(
        collection_name=settings.qdrant_collection,
        points=qdrant_points,
        wait=True,
    )
    logger.debug("qdrant_points_upserted", count=len(points))


async def search_vectors(
    query_vector: list[float],
    organization_id: uuid.UUID,
    limit: int,
) -> list[VectorHit]:
    """Return the nearest chunks for a query, restricted to one tenant."""
    if not await get_qdrant_client().collection_exists(settings.qdrant_collection):
        # Nothing has been ingested yet — the relational keyword branch still
        # works, so an empty vector branch is the correct degradation.
        logger.warning("qdrant_collection_missing", collection=settings.qdrant_collection)
        return []

    response = await get_qdrant_client().query_points(
        collection_name=settings.qdrant_collection,
        query=query_vector,
        query_filter=build_tenant_filter(organization_id),
        limit=limit,
        with_payload=False,
        with_vectors=False,
    )
    hits: list[VectorHit] = []
    for point in response.points:
        try:
            chunk_id = uuid.UUID(str(point.id))
        except (ValueError, AttributeError):
            # Never let a malformed external ID fail the whole tenant's chat.
            logger.warning("qdrant_invalid_point_id", point_id=str(point.id))
            continue
        hits.append(VectorHit(chunk_id=chunk_id, score=float(point.score)))
    return hits


async def delete_document_points(
    document_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> None:
    """Delete every vector belonging to a document (tenant-scoped)."""
    await get_qdrant_client().delete(
        collection_name=settings.qdrant_collection,
        points_selector=build_tenant_filter(
            organization_id,
            document_ids=[document_id],
        ),
        wait=True,
    )
    logger.debug(
        "qdrant_points_deleted",
        document_id=str(document_id),
        organization_id=str(organization_id),
    )
