"""
Hybrid retrieval service.

Combines:
1. Vector similarity search (Qdrant cosine distance, tenant-filtered)
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
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import ColumnElement, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.core.metrics import observe_retrieval_candidates, observe_retrieval_top_score
from app.core.telemetry import stage_span
from app.db.models.document import Document, DocumentAccessLevel, DocumentChunk, DocumentStatus
from app.providers import vector_store

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
    # Raw ts_rank_cd from the keyword branch (None for vector-only hits), kept
    # for the same reason: after fusion `score` no longer carries it.
    keyword_score: float | None = None


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
    from app.providers.embeddings import embed_query
    from app.providers.reranker import rerank

    k = top_k or settings.retrieval_top_k
    reranker_n = settings.reranker_top_n

    # Step 1: Embed the query
    # Local embedding and reranking run on CPU. Offload them so an active
    # request does not block the async server from sending other responses.
    with stage_span("embed_query"):
        query_vector = await asyncio.to_thread(embed_query, query)

    # Step 2: Vector search
    with stage_span("vector_search", top_k=k):
        vector_results = await _vector_search(
            query_vector=query_vector,
            organization_id=organization_id,
            db=db,
            limit=k,
            include_restricted=include_restricted,
        )
    observe_retrieval_candidates("vector", len(vector_results))

    # Step 3: Full-text keyword search
    with stage_span("keyword_search", top_k=k):
        keyword_results = await _keyword_search(
            query=query,
            organization_id=organization_id,
            db=db,
            limit=k,
            include_restricted=include_restricted,
        )
    observe_retrieval_candidates("keyword", len(keyword_results))

    # Step 4: RRF fusion
    with stage_span("fusion"):
        fused = _reciprocal_rank_fusion(
            ranked_lists=[vector_results, keyword_results],
            k=_RRF_K,
        )
    observe_retrieval_candidates("fused", len(fused))

    # Step 5: Optional reranking
    if settings.reranker_enabled and fused:
        passages_for_rerank = fused[: min(k, 20)]  # Don't rerank more than 20
        texts = [r.content for r in passages_for_rerank]
        with stage_span("rerank", candidates=len(texts)):
            ranked_indices = await asyncio.to_thread(rerank, query, texts, top_n=reranker_n)
        reranked = []
        for orig_idx, score in ranked_indices:
            p = passages_for_rerank[orig_idx]
            p.score = score
            p.retrieval_method = "reranked"
            reranked.append(p)
        observe_retrieval_candidates("reranked", len(reranked))

        # The relevance gate must run here too. This branch used to return every
        # reranked passage, so an unrelated question still fed the prompt (and
        # the model answered from noise). The cross-encoder score is the
        # authoritative relevance signal once reranking has run.
        filtered = [p for p in reranked if _passes_relevance_gate(p, reranked=True)]
        observe_retrieval_candidates("gated_out", len(reranked) - len(filtered))
        observe_retrieval_candidates("returned", len(filtered))
        if filtered:
            observe_retrieval_top_score(max(p.score for p in filtered))
        return filtered

    # Same gate for the fusion-only path. It is per-branch: a passage passes if
    # *either* signal clears its own threshold, because cosine similarity and
    # ts_rank_cd live on incomparable scales and RRF has already replaced
    # `score` with a rank-based value. Previously keyword-only hits were kept
    # unconditionally (`similarity is None or ...`), so the lexical branch had
    # no gate at all.
    filtered = [p for p in fused[:k] if _passes_relevance_gate(p, reranked=False)]
    observe_retrieval_candidates("gated_out", len(fused[:k]) - len(filtered))
    observe_retrieval_candidates("returned", len(filtered))
    best_similarity = [p.similarity for p in filtered if p.similarity is not None]
    if best_similarity:
        observe_retrieval_top_score(max(best_similarity))
    return filtered


def _passes_relevance_gate(passage: RetrievedPassage, *, reranked: bool) -> bool:
    """Decide whether a candidate is relevant enough to reach the prompt.

    Three different score scales are involved, so each branch is compared
    against the threshold that matches its scale rather than a single number:

    * reranked — the cross-encoder score (sigmoid, 0..1) vs ``min_rerank_score``;
    * fused — cosine similarity vs ``min_relevance_score``, or, for
      keyword-only hits, ts_rank_cd vs ``min_keyword_score``. A passage present
      in both lists passes if either signal clears its own threshold.

    A passage with neither signal (neither branch produced a comparable score)
    is kept: dropping it would silently discard results for a scorer this code
    does not know about.
    """
    if reranked:
        return passage.score >= settings.min_rerank_score

    if passage.similarity is None and passage.keyword_score is None:
        return True

    vector_ok = (
        passage.similarity is not None and passage.similarity >= settings.min_relevance_score
    )
    keyword_ok = (
        passage.keyword_score is not None and passage.keyword_score >= settings.min_keyword_score
    )
    return vector_ok or keyword_ok


def _access_scope_condition(
    include_restricted: bool,
) -> ColumnElement[bool] | None:
    """Document-level access condition: restricted docs require an admin."""
    if include_restricted:
        return None
    return Document.access_level == DocumentAccessLevel.ORGANIZATION


def _base_conditions(organization_id: uuid.UUID) -> list[ColumnElement[bool]]:
    """
    WHERE terms shared by both retrieval branches.

    Built as an explicit list on purpose. SQLAlchemy deliberately makes
    ``bool(BinaryExpression)`` false, so ``access_condition or true()``
    silently drops the access predicate and leaks restricted documents.
    Never combine these predicates with Python ``or``/``and``.
    """
    return [
        DocumentChunk.organization_id == organization_id,
        Document.organization_id == organization_id,  # redundant, defense-in-depth
        Document.status == DocumentStatus.READY,
        Document.is_active == True,  # noqa: E712
    ]


async def _vector_search(
    query_vector: list[float],
    organization_id: uuid.UUID,
    db: AsyncSession,
    limit: int,
    *,
    include_restricted: bool = False,
) -> list[RetrievedPassage]:
    """
    Cosine similarity search using Qdrant.

    Qdrant applies a mandatory ``organization_id`` payload filter server-side;
    the relational query below re-checks tenant, document status and access
    level before any passage reaches the prompt. The Qdrant point ID is the
    chunk UUID, which is how hits are joined back to relational rows.
    """
    # Over-fetch slightly so a few hits removed by the access filter do not
    # starve fusion when most of a tenant's corpus is restricted.
    hits = await vector_store.search_vectors(
        query_vector,
        organization_id,
        min(limit * 2, 200),
    )
    if not hits:
        return []

    hit_scores = {hit.chunk_id: hit.score for hit in hits}
    access_condition = _access_scope_condition(include_restricted)
    conditions = _base_conditions(organization_id)
    conditions.append(DocumentChunk.id.in_(list(hit_scores)))
    if access_condition is not None:
        conditions.append(access_condition)

    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.content,
            DocumentChunk.page_number,
            DocumentChunk.section_heading,
            Document.title,
        )
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(*conditions)
    )

    rows = (await db.execute(stmt)).all()
    results: list[RetrievedPassage] = []
    for row in rows:
        score = hit_scores.get(row.id)
        if score is None:  # stale Qdrant point whose chunk was deleted
            continue
        results.append(
            RetrievedPassage(
                chunk_id=row.id,
                document_id=row.document_id,
                document_title=row.title,
                content=row.content,
                page_number=row.page_number,
                section_heading=row.section_heading,
                score=score,
                retrieval_method="vector",
                similarity=score,
            )
        )

    # Preserve Qdrant's ranking after the relational filter removed hits.
    results.sort(key=lambda passage: hit_scores[passage.chunk_id], reverse=True)
    return results[:limit]


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
    conditions: list[Any] = list(_base_conditions(organization_id))
    conditions.append(
        text("document_chunks.content_tsv @@ plainto_tsquery('english', :q)").bindparams(q=query)
    )
    if access_condition is not None:
        conditions.append(access_condition)

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
        .where(*conditions)
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
            keyword_score=float(row.score),
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

    The inputs are never mutated: each fused passage is a copy carrying the
    RRF score, so a passage shared by two ranked lists cannot make the
    result depend on which list happened to be fused first.
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
    return [replace(best_passage[cid], score=rrf_scores[cid]) for cid in sorted_ids]
