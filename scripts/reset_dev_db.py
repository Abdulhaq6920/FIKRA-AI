"""
DEVELOPMENT ONLY: Drop and recreate the database schema.

This DELETES ALL DATA. Only run this in development.
Refuses to run if APP_ENV=production.

    python scripts/reset_dev_db.py --confirm
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.core.config import settings


async def reset() -> None:
    if settings.is_production:
        print("ERROR: Refusing to reset database in production environment.")
        sys.exit(1)

    if "--confirm" not in sys.argv:
        print("This will DELETE ALL DATA in the development database.")
        print("Run with --confirm to proceed.")
        sys.exit(1)

    from sqlalchemy.ext.asyncio import create_async_engine
    from app.db.base import Base
    import app.db.models  # noqa: F401

    engine = create_async_engine(settings.database_url, echo=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print(
        "\nDatabase reset complete. Run 'alembic stamp head' to mark migrations as current."
    )


if __name__ == "__main__":
    asyncio.run(reset())
