# ADR-003: RAG Retrieval Strategy

**Status**: Accepted  
**Date**: 2026-01-01

## Decision: Hybrid retrieval with RRF + optional reranking

Use both vector similarity (pgvector) and full-text keyword search (PostgreSQL tsvector), fuse with Reciprocal Rank Fusion, then optionally rerank with a local cross-encoder.

## Why hybrid?

| Method | Strength | Weakness |
|--------|---------|---------|
| Vector only | Semantic understanding, handles synonyms | Misses exact keywords; poor on names/codes |
| Keyword only | Exact match, predictable | No semantic understanding |
| Hybrid | Best of both | More complex; needs a fusion strategy |

Hybrid consistently outperforms either method alone on mixed question types typical of enterprise knowledge bases.

## Why RRF over score normalization?

RRF (`1/(k + rank)`) is robust — it doesn't require normalizing scores across incomparable scales (cosine similarity vs. BM25/ts_rank). The `k=60` constant prevents top-rank passages from dominating. No tuning required; it works well out of the box.

## Why cross-encoder reranking?

Bi-encoders (the embedding model) encode query and passage independently — fast but less accurate. Cross-encoders jointly encode the pair — slower but significantly more accurate for borderline cases. We run the reranker only on the top-20 fused candidates, not the full corpus, so latency impact is bounded.

Reranker adds ~50–200ms per request on CPU. Disable with `RERANKER_ENABLED=false` if latency is the priority.

## Retrieval parameters

| Parameter | Default | Effect |
|-----------|---------|--------|
| `RETRIEVAL_TOP_K` | 20 | Candidates from each retrieval method |
| `RERANKER_TOP_N` | 5 | Passages sent to LLM after reranking |
| `MIN_RELEVANCE_SCORE` | 0.3 | Floor threshold after reranking |

## Consequences

- Requires both pgvector and pg_trgm extensions
- The IVFFlat index needs `VACUUM ANALYZE` after bulk inserts
- Changing embedding model requires reindexing all documents
- Cross-encoder and embedding model are loaded in the worker process, not the API process
