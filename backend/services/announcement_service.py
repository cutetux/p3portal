# p3portal.org
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from backend.db.database import get_db


# Sentinel: distinguishes "not provided" from None (= clear the field)
class _MissingType:
    pass


MISSING: Any = _MissingType()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_expired(expires_at: str | None) -> bool:
    if not expires_at:
        return False
    return expires_at < _now()


def _row_to_dict(row) -> dict:
    r = dict(row)
    r["active"] = bool(r["active"])
    r["expired"] = _is_expired(r.get("expires_at"))
    return r


async def list_active() -> list[dict]:
    """Return active, non-expired announcements (newest first) – for Dashboard."""
    now = _now()
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, message, severity, active, expires_at, created_by, created_at, updated_at
                   FROM announcements
                   WHERE active = 1
                     AND (expires_at IS NULL OR expires_at > :now)
                   ORDER BY created_at DESC"""
            ),
            {"now": now},
        )
        rows = result.mappings().fetchall()
    return [_row_to_dict(r) for r in rows]


async def list_all() -> list[dict]:
    """Return all announcements including inactive/expired – for Admin table."""
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, message, severity, active, expires_at, created_by, created_at, updated_at
                   FROM announcements
                   ORDER BY created_at DESC"""
            )
        )
        rows = result.mappings().fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_by_id(announcement_id: int) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, message, severity, active, expires_at, created_by, created_at, updated_at
                   FROM announcements WHERE id = :id"""
            ),
            {"id": announcement_id},
        )
        row = result.mappings().fetchone()
    return _row_to_dict(row) if row else None


async def create(
    message: str,
    severity: str,
    active: bool,
    expires_at: str | None,
    created_by: str,
) -> dict:
    now = _now()
    async with get_db() as session:
        result = await session.execute(
            text(
                """INSERT INTO announcements (message, severity, active, expires_at, created_by, created_at, updated_at)
                   VALUES (:message, :severity, :active, :expires_at, :created_by, :now, :now)
                   RETURNING id"""
            ),
            {
                "message": message,
                "severity": severity,
                "active": 1 if active else 0,
                "expires_at": expires_at,
                "created_by": created_by,
                "now": now,
            },
        )
        row = result.fetchone()
        await session.commit()
    return await get_by_id(row[0])  # type: ignore[index]


async def update(
    announcement_id: int,
    message: str | None = None,
    severity: str | None = None,
    active: bool | None = None,
    expires_at: Any = MISSING,
) -> dict | None:
    existing = await get_by_id(announcement_id)
    if not existing:
        return None

    new_message = message if message is not None else existing["message"]
    new_severity = severity if severity is not None else existing["severity"]
    new_active = active if active is not None else existing["active"]
    new_expires_at = existing["expires_at"] if isinstance(expires_at, _MissingType) else expires_at

    now = _now()
    async with get_db() as session:
        await session.execute(
            text(
                """UPDATE announcements
                   SET message = :message, severity = :severity, active = :active,
                       expires_at = :expires_at, updated_at = :now
                   WHERE id = :id"""
            ),
            {
                "message": new_message,
                "severity": new_severity,
                "active": 1 if new_active else 0,
                "expires_at": new_expires_at,
                "now": now,
                "id": announcement_id,
            },
        )
        await session.commit()
    return await get_by_id(announcement_id)


async def delete(announcement_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM announcements WHERE id = :id"),
            {"id": announcement_id},
        )
        await session.commit()
    return result.rowcount > 0
