"""Measure the score scales the relevance gate must threshold on.

Prints (a) cross-encoder logits for the real corpus against a relevant and an
irrelevant question, and (b) ts_rank_cd values for the same two questions.
Both are needed to pick a default that drops noise without dropping real hits.
"""

from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import text

from app.db.session import engine
from app.providers.embeddings import embed_query
from app.providers.reranker import rerank

RELEVANT = "When does benefits enrolment close?"
IRRELEVANT = "What is the capital of Peru?"


async def chunks() -> list[tuple[str, str]]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "select d.title, c.content from document_chunks c "
                "join documents d on d.id = c.document_id order by c.chunk_index"
            )
        )
        return [(r[0], r[1]) for r in rows]


async def ts_ranks(question: str) -> list[tuple[str, float]]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "select left(c.content, 40), ts_rank_cd(c.content_tsv, plainto_tsquery('english', :q)) "
                "from document_chunks c "
                "where c.content_tsv @@ plainto_tsquery('english', :q) "
                "order by 2 desc limit 5"
            ),
            {"q": question},
        )
        return [(r[0], float(r[1])) for r in rows]


async def main() -> None:
    corpus = await chunks()
    print(f"corpus chunks: {len(corpus)}")
    texts = [c for _t, c in corpus]

    for question in (RELEVANT, IRRELEVANT):
        print(f"\n=== {question!r} ===")
        vector = embed_query(question)
        async with engine.connect() as conn:
            rows = await conn.execute(
                text(
                    "select d.title, 1 - (c.embedding <=> cast(:v as vector)) as sim "
                    "from document_chunks c join documents d on d.id = c.document_id "
                    "order by sim desc limit 3"
                ),
                {"v": str(vector)},
            )
            for title, sim in rows:
                print(f"  vector sim  {float(sim):.4f}  {title}")
        ranked = rerank(question, texts, top_n=5)
        for idx, score in ranked:
            print(f"  rerank      {float(score):+8.3f}  {texts[idx][:60]!r}")
        for snippet, rank in await ts_ranks(question):
            print(f"  ts_rank_cd  {rank:.6f}  {snippet!r}")


asyncio.run(main())
