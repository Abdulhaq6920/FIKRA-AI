"""
Hybrid retrieval service.

Combines:
1. Vector similarity search (pgvector cosine distance)
2. PostgreSQL full-text search (tsvector/tsquery)
3. Reciprocal Rank Fusion (RRF) to merge results
4. Optional cross-encoder reranking

Tenant isolation:
- ALL queries include organization_id and document active/ready filters.
- The query builder never accepts tenant IDs from the frontend.
- Tenant context comes from the authenticated server-side identity.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, func, select, text, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.document import Document, DocumentAccessLevel, DocumentChunk, DocumentStatus

logger = get_logger(__name__)

# RRF constant (60 is the standard value from the original RRF paper)
_RRF_K = 60


@dataclass
class RetrievedPassage:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    content: str
    page_number: int | None
    section_heading: str | None
    score: float
    retrieval_method: str  # "vector", "keyword", or "reranked"
    # Cosine similarity from the vector search (None for keyword-only hits).
    # Kept separately because RRF overwrites `score` with a small fusion value.
    similarity: float | None = None


async def retrieve(
    query: str,
    organization_id: uuid.UUID,
    db: AsyncSession,
    *,
    top_k: int | None = None,
    include_restricted: bool = False,
) -> list[RetrievedPassage]:
    """
    Retrieve the most relevant document passages for *query*.

    All DB queries are filtered by organization_id — this is the primary
    tenant-isolation enforcement point for retrieval. Documents marked
    ``access_level=restricted`` are excluded unless *include_restricted*
    is set (org admins only), so the chat pipeline cannot leak content a
    member is not allowed to read.
    """
    # Lazy import so app starts without sentence-transformers installed
    from app.providers.embeddings import embed_query  # noqa: PLC0415
    from app.providers.reranker import rerank  # noqa: PLC0415

    k = top_k or settings.retrieval_top_k
    reranker_n = settings.reranker_top_n

    # Step 1: Embed the query
    # Local embedding and reranking run on CPU. Offload them so an active
    # request does not block the async server from sending other responses.
    query_vector = await asyncio.to_thread(embed_query, query)

    # Step 2: Vector search
    vector_results = await _vector_search(
        query_vector=query_vector,
        organization_id=organization_id,
        db=db,
        limit=k,
        include_restricted=include_restricted,
    )

    # Step 3: Full-text keyword search
    keyword_results = await _keyword_search(
        query=query,
        organization_id=organization_id,
        db=db,
        limit=k,
        include_restricted=include_restricted,
    )

    # Step 4: RRF fusion
    fused = _reciprocal_rank_fusion(
        ranked_lists=[vector_results, keyword_results],
        k=_RRF_K,
    )

    # Step 5: Optional reranking
    if settings.reranker_enabled and fused:
        passages_for_rerank = fused[: min(k, 20)]  # Don't rerank more than 20
        texts = [r.content for r in passages_for_rerank]
        ranked_indices = await asyncio.to_thread(rerank, query, texts, top_n=reranker_n)
        reranked = []
        for orig_idx, score in ranked_indices:
            p = passages_for_rerank[orig_idx]
            p.score = score
            p.retrieval_method = "reranked"
            reranked.append(p)
        return reranked

    # Filter by minimum relevance. RRF scores are rank-based (bounded well below
    # 1.0), so the threshold is applied to the vector similarity instead;
    # keyword-only hits have no similarity and are kept.
    filtered = [
        p for p in fused[:k] if p.similarity is None or p.similarity >= settings.min_relevance_score
    ]
    return filtered


def _access_scope_condition(
    include_restricted: bool,
) -> ColumnElement[bool] | None:
    """Document-level access condition: restricted docs require an admin."""
    if include_restricted:
        return None
    return Document.access_level == DocumentAccessLevel.ORGANIZATION


async def _vector_search(
    query_vector: list[float],
    organization_id: uuid.UUID,
    db: AsyncSession,
    limit: int,
    *,
    include_restricted: bool = False,
) -> list[RetrievedPassage]:
    """
    Cosine similarity search using pgvector.

    The organization_id filter is mandatory — it is part of the WHERE clause,
    not a post-filter, so the database enforces tenant isolation.
    """
    access_condition = _access_scope_condition(include_restricted)
    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.content,
            DocumentChunk.page_number,
            DocumentChunk.section_heading,
            Document.title,
            # cosine distance (lower = more similar); convert to similarity score
            (1 - DocumentChunk.embedding.cosine_distance(query_vector)).label("score"),
        )
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(
            DocumentChunk.organization_id == organization_id,
            Document.organization_id == organization_id,  # redundant, defense-in-depth
            Document.status == DocumentStatus.READY,
            Document.is_active == True,  # noqa: E712
            access_condition or true(),
        )
        .order_by(text("score DESC"))
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    results = []
    for row in rows:
        results.append(
            RetrievedPassage(
                chunk_id=row.id,
                document_id=row.document_id,
                document_title=row.title,
                content=row.content,
                page_number=row.page_number,
                section_heading=row.section_heading,
                score=float(row.score),
                retrieval_method="vector",
                similarity=float(row.score),
            )
        )
    return results


async def _keyword_search(
    query: str,
    organization_id: uuid.UUID,
    db: AsyncSession,
    limit: int,
    *,
    include_restricted: bool = False,
) -> list[RetrievedPassage]:
    """
    Full-text search using PostgreSQL tsvector.

    Uses plainto_tsquery for safety — never passes raw user input
    directly into a tsquery expression.
    """
    access_condition = _access_scope_condition(include_restricted)

    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.content,
            DocumentChunk.page_number,
            DocumentChunk.section_heading,
            Document.title,
            func.ts_rank_cd(
                text("document_chunks.content_tsv"),
                func.plainto_tsquery("english", query),
            ).label("score"),
        )
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(
            DocumentChunk.organization_id == organization_id,
            Document.organization_id == organization_id,
            Document.status == DocumentStatus.READY,
            Document.is_active == True,  # noqa: E712
            text("document_chunks.content_tsv @@ plainto_tsquery('english', :q)").bindparams(
                q=query
            ),
            access_condition or true(),
        )
        .order_by(text("score DESC"))
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    return [
        RetrievedPassage(
            chunk_id=row.id,
            document_id=row.document_id,
            document_title=row.title,
            content=row.content,
            page_number=row.page_number,
            section_heading=row.section_heading,
            score=float(row.score),
            retrieval_method="keyword",
        )
        for row in rows
    ]


def _reciprocal_rank_fusion(
    ranked_lists: list[list[RetrievedPassage]],
    k: int = 60,
) -> list[RetrievedPassage]:
    """
    Merge multiple ranked lists using Reciprocal Rank Fusion.

    RRF score for document d: sum over lists L of 1 / (k + rank(d, L))
    where rank is 1-indexed.

    Documents missing from a list receive no contribution from that list.
    """
    rrf_scores: dict[uuid.UUID, float] = {}
    best_passage: dict[uuid.UUID, RetrievedPassage] = {}

    for ranked in ranked_lists:
        for rank, passage in enumerate(ranked, start=1):
            cid = passage.chunk_id
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (k + rank)
            # Keep the passage object from the first list that saw this chunk
            if cid not in best_passage:
                best_passage[cid] = passage

    sorted_ids = sorted(rrf_scores.keys(), key=lambda cid: rrf_scores[cid], reverse=True)
    result = []
    for cid in sorted_ids:
        p = best_passage[cid]
        p.score = rrf_scores[cid]
        result.append(p)
    return result
