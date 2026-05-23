# p3portal.org
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db


async def write_audit_log(
    event_type: str,
    username: str | None = None,
    auth_type: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    detail: str | None = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with get_db() as db:
            await db.execute(
                text(
                    "INSERT INTO audit_logs "
                    "(event_type, username, auth_type, ip_address, user_agent, detail, created_at) "
                    "VALUES (:event_type, :username, :auth_type, :ip_address, :user_agent, :detail, :created_at)"
                ),
                {
                    "event_type": event_type,
                    "username": username,
                    "auth_type": auth_type,
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                    "detail": detail,
                    "created_at": now,
                },
            )
            await db.commit()
    except Exception:
        pass  # Audit logging must never break the main request


async def get_audit_logs(
    limit: int = 100,
    offset: int = 0,
    event_type: str | None = None,
    username: str | None = None,
) -> list[dict]:
    conditions = []
    params: dict = {"limit": limit, "offset": offset}

    if event_type:
        conditions.append("event_type = :event_type")
        params["event_type"] = event_type
    if username:
        conditions.append("username LIKE :username")
        params["username"] = f"%{username}%"

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"SELECT * FROM audit_logs {where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

    async with get_db() as db:
        result = await db.execute(text(sql), params)
        rows = result.fetchall()
        keys = result.keys()
        return [dict(zip(keys, row)) for row in rows]


async def count_audit_logs(
    event_type: str | None = None,
    username: str | None = None,
) -> int:
    conditions = []
    params: dict = {}

    if event_type:
        conditions.append("event_type = :event_type")
        params["event_type"] = event_type
    if username:
        conditions.append("username LIKE :username")
        params["username"] = f"%{username}%"

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"SELECT COUNT(*) FROM audit_logs {where}"

    async with get_db() as db:
        result = await db.execute(text(sql), params)
        row = result.fetchone()
        return row[0] if row else 0
