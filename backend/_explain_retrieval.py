"""Prove the vector query is index-usable, at a realistic corpus size.

The live database holds four chunks, so the planner would seq-scan regardless of
query shape. This script inserts 8 000 synthetic chunks **with realistic
embedding structure** (unit-norm vectors clustered around 32 topic centres, the
shape a real embedding space has) inside a transaction, ANALYZEs, runs EXPLAIN
on the old and new ORDER BY forms, compares recall against an exact scan, and
rolls back — the data never becomes visible to any other session.

Uniform-random vectors are deliberately *not* used: in 384 dimensions all
distances to uniform noise are ~1.0, so k-means produces meaningless lists and
ivfflat recall collapses. That is a property of the synthetic data, not of the
query, and would have produced a misleading "the index returns nothing" result.

What it must show:
  old: ORDER BY 1 - (embedding <=> v) DESC  → Seq Scan + Sort (index unusable)
  new: ORDER BY embedding <=> v             → Index Scan using the ivfflat index
  keyword: content_tsv @@ plainto_tsquery   → Bitmap Index Scan using the GIN index
"""

from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

import numpy as np
from sqlalchemy import text

from app.db.session import engine

CLUSTERS = 32
PER_CLUSTER = 250
DIMS = 384
SPREAD = 0.08
SEED = 42

VECTOR_SQL_OLD = """
    select c.id, c.document_id, c.content, c.page_number, c.section_heading, d.title,
           1 - (c.embedding <=> cast(:v as vector)) as score
    from document_chunks c
    join documents d on c.document_id = d.id
    where c.organization_id = :org
      and d.organization_id = :org
      and d.status = 'ready'
      and d.is_active = true
      and c.embedding is not null
      and d.access_level = 'organization'
    order by 1 - (c.embedding <=> cast(:v as vector)) desc
    limit 12
"""

VECTOR_SQL_NEW = VECTOR_SQL_OLD.replace(
    "order by 1 - (c.embedding <=> cast(:v as vector)) desc",
    "order by c.embedding <=> cast(:v as vector)",
)

KEYWORD_SQL = """
    select c.id, ts_rank_cd(c.content_tsv, plainto_tsquery('english', :q)) as score
    from document_chunks c
    join documents d on c.document_id = d.id
    where c.organization_id = :org
      and d.organization_id = :org
      and d.status = 'ready'
      and d.is_active = true
      and c.content_tsv @@ plainto_tsquery('english', :q)
      and d.access_level = 'organization'
    order by score desc
    limit 12
"""


def as_literal(vector: np.ndarray) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


def make_corpus() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(SEED)
    centres = rng.normal(size=(CLUSTERS, DIMS))
    centres /= np.linalg.norm(centres, axis=1, keepdims=True)
    points = []
    for centre in centres:
        block = centre + SPREAD * rng.normal(size=(PER_CLUSTER, DIMS))
        block /= np.linalg.norm(block, axis=1, keepdims=True)
        points.append(block)
    query = centres[0] + 0.01 * rng.normal(size=DIMS)
    query /= np.linalg.norm(query)
    return np.vstack(points), query


async def show(conn, label: str, sql: str, params: dict) -> list[str]:
    rows = (await conn.execute(text(f"EXPLAIN (ANALYZE, BUFFERS) {sql}"), params)).all()
    plan = "\n".join(row[0] for row in rows)
    print(f"\n--- {label} ---")
    for line in plan.splitlines():
        if any(key in line for key in ("Scan", "Sort", "Buffers", "Execution Time", "Index Searches")):
            print(line)
    return [line.strip() for line in plan.splitlines()]


async def ids(conn, sql: str, params: dict) -> list[str]:
    rows = (await conn.execute(text(f"select id from ({sql}) t"), params)).all()
    return [str(row[0]) for row in rows]


async def main() -> None:
    corpus, query = make_corpus()
    literal = as_literal(query)

    async with engine.connect() as conn:
        trans = await conn.begin()
        try:
            doc_id, org_id = (
                await conn.execute(
                    text(
                        "select d.id, d.organization_id from documents d "
                        "where d.status = 'ready' order by d.created_at limit 1"
                    )
                )
            ).first()

            payload = [
                {
                    "doc_id": doc_id,
                    "org_id": org_id,
                    "idx": 100_000 + i,
                    "content": f"synthetic chunk {i} benefits onboarding payroll",
                    "hash": f"{i:064d}",
                    "embedding": as_literal(row),
                }
                for i, row in enumerate(corpus)
            ]
            await conn.execute(
                text(
                    "insert into document_chunks (id, document_id, organization_id, content, "
                    "content_hash, chunk_index, token_count, embedding) values "
                    "(gen_random_uuid(), :doc_id, :org_id, :content, :hash, :idx, 10, "
                    "cast(:embedding as vector))"
                ),
                payload,
            )
            await conn.execute(text("analyze document_chunks"))
            await conn.execute(text("analyze documents"))
            total = (await conn.execute(text("select count(*) from document_chunks"))).scalar()
            print(f"synthetic corpus size (inside transaction): {total}")

            params = {"v": literal, "org": org_id}

            # Exact ground truth, then the same query through the index.
            truth = await ids(conn, VECTOR_SQL_OLD, params)
            print(f"ground-truth top-12 (exact scan): {len(truth)}")

            await show(conn, "OLD ordering (1 - distance DESC)", VECTOR_SQL_OLD, params)
            await show(conn, "NEW ordering (distance ASC)", VECTOR_SQL_NEW, params)

            for probes in (1, 10):
                await conn.execute(text(f"set local ivfflat.probes = {probes}"))
                found = await ids(conn, VECTOR_SQL_NEW, params)
                overlap = len(set(truth) & set(found))
                print(f"recall@12 with ivfflat.probes={probes}: {overlap}/12")

            await show(
                conn,
                "KEYWORD branch (GIN)",
                KEYWORD_SQL,
                {"q": "benefits payroll", "org": org_id},
            )
        finally:
            await trans.rollback()
            print("\nrolled back; live corpus unchanged")


asyncio.run(main())
