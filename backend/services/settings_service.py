# p3portal.org
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db


async def get_setting(key: str) -> str | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT value FROM settings WHERE key = :key"), {"key": key}
        )
        row = result.mappings().fetchone()
    return row["value"] if row else None


async def set_setting(key: str, value: str, updated_by: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        # SQLite/PostgreSQL UPSERT – für MariaDB: ON DUPLICATE KEY UPDATE
        await session.execute(
            text(
                """INSERT INTO settings (key, value, updated_at, updated_by)
                   VALUES (:key, :value, :updated_at, :updated_by)
                   ON CONFLICT(key) DO UPDATE SET
                       value      = excluded.value,
                       updated_at = excluded.updated_at,
                       updated_by = excluded.updated_by"""
            ),
            {"key": key, "value": value, "updated_at": now, "updated_by": updated_by},
        )
        await session.commit()


async def delete_setting(key: str) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM settings WHERE key = :key"), {"key": key}
        )
        await session.commit()
        return result.rowcount > 0
