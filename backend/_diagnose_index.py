"""Diagnose why the ivfflat index returns no rows after bulk insert."""

from __future__ import annotations

import asyncio
import random
import sys

sys.path.insert(0, ".")

from sqlalchemy import text

from app.db.session import engine

ROWS = 20_000
DIMS = 384

INSERT = text(
    """
    insert into document_chunks (
        id, document_id, organization_id, content, content_hash,
        chunk_index, token_count, embedding
    )
    select gen_random_uuid(), :doc_id, :org_id,
           'synthetic ' || i || ' benefits payroll',
           md5(i::text), 100000 + i, 10,
           (select ('[' || string_agg(random()::text, ',') || ']')::vector
            from generate_series(1, :dims))
    from generate_series(1, :rows) as i
    """
)

COUNT_SQL = """
    select count(*) from (
        select c.id from document_chunks c
        where c.organization_id = :org
        order by c.embedding <=> cast(:v as vector)
        limit 12
    ) t
"""


async def probe(conn, label: str, vector: str, org) -> None:
    rows = (await conn.execute(text(COUNT_SQL), {"v": vector, "org": org})).scalar()
    plan = (
        await conn.execute(
            text(f"explain (analyze) {COUNT_SQL}"),
            {"v": vector, "org": org},
        )
    ).all()
    used = [r[0].strip() for r in plan if "Scan" in r[0]]
    print(f"{label}: rows={rows}  plan={used}")


async def main() -> None:
    vector = "[" + ",".join(f"{random.random():.6f}" for _ in range(DIMS)) + "]"
    async with engine.connect() as conn:
        trans = await conn.begin()
        try:
            doc_id, org = (
                await conn.execute(
                    text("select id, organization_id from documents where status='ready' limit 1")
                )
            ).first()
            await conn.execute(
                INSERT, {"doc_id": doc_id, "org_id": org, "rows": ROWS, "dims": DIMS}
            )
            await conn.execute(text("analyze document_chunks"))

            await probe(conn, "after insert (default)", vector, org)
            await conn.execute(text("set local enable_seqscan = off"))
            await probe(conn, "after insert (seqscan off)", vector, org)

            await conn.execute(text("reindex index ix_chunks_embedding_ivfflat"))
            await probe(conn, "after reindex", vector, org)

            await conn.execute(text("drop index ix_chunks_embedding_ivfflat"))
            await conn.execute(
                text(
                    "create index ix_chunks_embedding_ivfflat on document_chunks "
                    "using ivfflat (embedding vector_cosine_ops) with (lists = 100)"
                )
            )
            await conn.execute(text("analyze document_chunks"))
            await probe(conn, "after rebuild on populated table", vector, org)
            await conn.execute(text("set local ivfflat.probes = 10"))
            await probe(conn, "after rebuild, probes=10", vector, org)
        finally:
            await trans.rollback()


asyncio.run(main())
