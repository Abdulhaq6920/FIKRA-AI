"""Narrow down why the ivfflat scan yields 0 rows: literal vs bound parameter."""

from __future__ import annotations

import asyncio
import random
import sys

sys.path.insert(0, ".")

from sqlalchemy import text

from app.db.session import engine

ROWS = 5_000
DIMS = 384

INSERT = text(
    """
    insert into document_chunks (
        id, document_id, organization_id, content, content_hash,
        chunk_index, token_count, embedding
    )
    select gen_random_uuid(), :doc_id, :org_id, 'synthetic ' || i, md5(i::text),
           100000 + i, 10,
           (select ('[' || string_agg(random()::text, ',') || ']')::vector
            from generate_series(1, :dims))
    from generate_series(1, :rows) as i
    """
)


async def main() -> None:
    literal = "[" + ",".join(f"{random.random():.6f}" for _ in range(DIMS)) + "]"
    async with engine.connect() as conn:
        trans = await conn.begin()
        try:
            doc_id, org = (
                await conn.execute(
                    text("select id, organization_id from documents where status='ready' limit 1")
                )
            ).first()
            await conn.execute(INSERT, {"doc_id": doc_id, "org_id": org, "rows": ROWS, "dims": DIMS})
            await conn.execute(text("analyze document_chunks"))

            total = (await conn.execute(text("select count(*) from document_chunks"))).scalar()
            meta = (
                await conn.execute(
                    text(
                        "select reltuples, relpages from pg_class "
                        "where relname = 'ix_chunks_embedding_ivfflat'"
                    )
                )
            ).first()
            print(f"chunks={total} index reltuples={meta[0]} relpages={meta[1]}")

            first = (
                await conn.execute(text("select embedding::text from document_chunks limit 1"))
            ).scalar()
            print(f"first stored vector prefix: {first[:60]}... dims={first.count(',') + 1}")

            d = (
                await conn.execute(
                    text(
                        "select embedding <=> cast(:v as vector) as dist "
                        "from document_chunks limit 3"
                    ),
                    {"v": literal},
                )
            ).all()
            print(f"bound-param distances (seq scan): {[round(float(r[0]), 4) for r in d]}")

            lit_rows = (
                await conn.execute(
                    text(
                        f"select count(*) from (select id from document_chunks "
                        f"order by embedding <=> '{literal}'::vector limit 12) t"
                    )
                )
            ).scalar()
            print(f"LITERAL vector, index order: {lit_rows} rows")

            param_rows = (
                await conn.execute(
                    text(
                        "select count(*) from (select id from document_chunks "
                        "order by embedding <=> cast(:v as vector) limit 12) t"
                    ),
                    {"v": literal},
                )
            ).scalar()
            print(f"BOUND param cast as vector, index order: {param_rows} rows")

            typed_rows = (
                await conn.execute(
                    text(
                        "select count(*) from (select id from document_chunks "
                        "order by embedding <=> cast(:v as vector(384)) limit 12) t"
                    ),
                    {"v": literal},
                )
            ).scalar()
            print(f"BOUND param cast as vector(384), index order: {typed_rows} rows")
        finally:
            await trans.rollback()


asyncio.run(main())
