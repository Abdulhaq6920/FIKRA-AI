"""
Bootstrap script: create the initial organization and platform admin user.

Uses raw SQL so it works regardless of SQLAlchemy enum mapping quirks.
Run once after 'alembic upgrade head':

    python scripts/create_initial_org.py

Creates:
    Organization: "Demo Organization"  (id: 00000000-0000-0000-0000-000000000001)
    Platform admin: admin@fikra.ai  /  Admin1234!

Change the password after first login.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import asyncpg

ORG_ID = "00000000-0000-0000-0000-000000000001"
ADMIN_EMAIL = "admin@fikra.ai"
ADMIN_PASSWORD = "Admin1234!"
ADMIN_NAME = "Platform Admin"


async def create_initial_data() -> None:
    from app.core.config import settings
    from app.core.security import hash_password

    # asyncpg uses plain postgres:// URLs, not postgresql+asyncpg://
    raw_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    conn = await asyncpg.connect(raw_url)

    try:
        # ── Organization ──────────────────────────────────────────────────
        existing_org = await conn.fetchval(
            "SELECT id FROM organizations WHERE id = $1",
            uuid.UUID(ORG_ID)
        )
        if existing_org:
            print(f"Organization already exists: {ORG_ID}")
        else:
            await conn.execute(
                """
                INSERT INTO organizations
                    (id, name, slug, status, allow_registration,
                     max_users, max_documents, max_storage_mb,
                     created_at, updated_at)
                VALUES
                    ($1, $2, $3, 'active', true,
                     100, 1000, 5000,
                     NOW(), NOW())
                """,
                uuid.UUID(ORG_ID), "Demo Organization", "demo"
            )
            print(f"Created organization: Demo Organization  (id: {ORG_ID})")

        # ── Admin user ────────────────────────────────────────────────────
        existing_user = await conn.fetchval(
            "SELECT id FROM users WHERE email_normalized = $1",
            ADMIN_EMAIL.lower()
        )
        if existing_user:
            print(f"Admin user already exists: {ADMIN_EMAIL}")
            admin_id = existing_user
        else:
            hashed = hash_password(ADMIN_PASSWORD)
            admin_id = uuid.uuid4()
            await conn.execute(
                """
                INSERT INTO users
                    (id, email, email_normalized, hashed_password,
                     full_name, status, is_platform_admin,
                     created_at, updated_at)
                VALUES
                    ($1, $2, $3, $4,
                     $5, 'active', true,
                     NOW(), NOW())
                """,
                admin_id,
                ADMIN_EMAIL,
                ADMIN_EMAIL.lower(),
                hashed,
                ADMIN_NAME
            )
            print(f"Created admin user: {ADMIN_EMAIL}")
            print(f"  Password: {ADMIN_PASSWORD}")
            print("  WARNING: Change this password after first login!")

        # ── Membership ────────────────────────────────────────────────────
        existing_mem = await conn.fetchval(
            "SELECT id FROM organization_memberships WHERE user_id = $1 AND organization_id = $2",
            admin_id, uuid.UUID(ORG_ID)
        )
        if not existing_mem:
            await conn.execute(
                """
                INSERT INTO organization_memberships
                    (id, user_id, organization_id, role, is_active, created_at, updated_at)
                VALUES
                    ($1, $2, $3, 'org_admin', true, NOW(), NOW())
                """,
                uuid.uuid4(), admin_id, uuid.UUID(ORG_ID)
            )
            print("Created org_admin membership.")

    finally:
        await conn.close()

    print("\nInitial data ready.")
    print(f"  Organization ID for login: {ORG_ID}")
    print(f"  Login at: http://localhost:3000/login")


if __name__ == "__main__":
    asyncio.run(create_initial_data())
