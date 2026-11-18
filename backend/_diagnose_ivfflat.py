"""Decisive ivfflat diagnostic: probes, buffers, and a freshly built index."""

from __future__ import annotations

import asyncio
import random
import sys

sys.path.insert(0, ".")

from sqlalchemy import text

from app.db.session import engine

DIMS = 384


def vec() -> str:
    return "[" + ",".join(f"{random.random():.6f}" for _ in range(DIMS)) + "]"


async def main() -> None:
    literal = vec()
    async with engine.connect() as conn:
        trans = await conn.begin()
        try:
            # A scratch table, no relation to the real corpus or its index history.
            await conn.execute(
                text(
                    f"create table scratch_chunks (id serial primary key, "
                    f"embedding vector({DIMS}) not null)"
                )
            )
            await conn.execute(
                text(
                    "insert into scratch_chunks (embedding) "
                    "select (select ('[' || string_agg(random()::text, ',') || ']')::vector "
                    "        from generate_series(1, :dims)) "
                    "from generate_series(1, 20000)"
                ),
                {"dims": DIMS},
            )
            await conn.execute(
                text(
                    "create index scratch_ivf on scratch_chunks "
                    "using ivfflat (embedding vector_cosine_ops) with (lists = 100)"
                )
            )
            await conn.execute(text("analyze scratch_chunks"))
            size = (
                await conn.execute(text("select pg_size_pretty(pg_relation_size('scratch_ivf'))"))
            ).scalar()
            print(f"scratch index built on 20k rows: {size}")

            for probes in (1, 10, 100):
                await conn.execute(text(f"set local ivfflat.probes = {probes}"))
                rows = (
                    await conn.execute(
                        text(
                            f"select count(*) from (select id from scratch_chunks "
                            f"order by embedding <=> '{literal}'::vector limit 12) t"
                        )
                    )
                ).scalar()
                print(f"  fresh index, probes={probes:>3}: {rows} rows")

            # Same data, index built first on an empty table (migration order).
            await conn.execute(text("drop index scratch_ivf"))
            await conn.execute(
                text(
                    "create index scratch_ivf on scratch_chunks "
                    "using ivfflat (embedding vector_cosine_ops) with (lists = 100)"
                )
            )
            await conn.execute(text("truncate scratch_chunks"))
            await conn.execute(
                text(
                    "insert into scratch_chunks (embedding) "
                    "select (select ('[' || string_agg(random()::text, ',') || ']')::vector "
                    "        from generate_series(1, :dims)) "
                    "from generate_series(1, 20000)"
                ),
                {"dims": DIMS},
            )
            await conn.execute(text("analyze scratch_chunks"))
            for probes in (1, 10, 100):
                await conn.execute(text(f"set local ivfflat.probes = {probes}"))
                rows = (
                    await conn.execute(
                        text(
                            f"select count(*) from (select id from scratch_chunks "
                            f"order by embedding <=> '{literal}'::vector limit 12) t"
                        )
                    )
                ).scalar()
                print(f"  index built on EMPTY table, probes={probes:>3}: {rows} rows")
        finally:
            await trans.rollback()


asyncio.run(main())
