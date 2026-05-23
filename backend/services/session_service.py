# p3portal.org
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db


async def create_session(
    username: str,
    jti: str,
    expires_at: str,
    ip_address: str | None,
    user_agent: str | None,
) -> str:
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text(
                "INSERT INTO user_sessions "
                "(id, username, jti, created_at, expires_at, ip_address, user_agent, revoked) "
                "VALUES (:id, :username, :jti, :created_at, :expires_at, :ip, :ua, 0)"
            ),
            {
                "id": session_id,
                "username": username,
                "jti": jti,
                "created_at": now,
                "expires_at": expires_at,
                "ip": ip_address,
                "ua": user_agent,
            },
        )
        await db.commit()
    return session_id


async def is_jti_revoked(jti: str) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT revoked FROM user_sessions WHERE jti = :jti"),
            {"jti": jti},
        )
        row = result.mappings().fetchone()
    if row is None:
        return False
    return bool(row["revoked"])


async def list_active_sessions(username: str) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, jti, created_at, expires_at, ip_address, user_agent "
                "FROM user_sessions "
                "WHERE username = :username AND revoked = 0 AND expires_at > :now "
                "ORDER BY created_at DESC"
            ),
            {"username": username, "now": now},
        )
        rows = result.mappings().fetchall()
    return [dict(r) for r in rows]


async def revoke_session_by_id(session_id: str, username: str) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text(
                "UPDATE user_sessions SET revoked = 1 "
                "WHERE id = :id AND username = :username"
            ),
            {"id": session_id, "username": username},
        )
        await db.commit()
    return result.rowcount > 0


async def revoke_all_except_jti(username: str, current_jti: str) -> int:
    async with get_db() as db:
        result = await db.execute(
            text(
                "UPDATE user_sessions SET revoked = 1 "
                "WHERE username = :username AND jti != :jti AND revoked = 0"
            ),
            {"username": username, "jti": current_jti},
        )
        await db.commit()
    return result.rowcount


async def revoke_session_by_jti(jti: str) -> None:
    async with get_db() as db:
        await db.execute(
            text("UPDATE user_sessions SET revoked = 1 WHERE jti = :jti"),
            {"jti": jti},
        )
        await db.commit()


async def revoke_all_for_user(
    username: str,
    reason: str,
    except_jti: str | None = None,
) -> int:
    """Revoke all active sessions for a user (PROJ-67 Phase 1 – F-003).

    Called on password-reset, account-disable, and self-password-change.
    Returns the number of sessions revoked.
    Writes a `sessions_bulk_revoked` audit event.
    """
    from backend.services.audit_service import write_audit_log

    async with get_db() as db:
        if except_jti:
            result = await db.execute(
                text(
                    "UPDATE user_sessions SET revoked = 1 "
                    "WHERE username = :username AND jti != :jti AND revoked = 0"
                ),
                {"username": username, "jti": except_jti},
            )
        else:
            result = await db.execute(
                text(
                    "UPDATE user_sessions SET revoked = 1 "
                    "WHERE username = :username AND revoked = 0"
                ),
                {"username": username},
            )
        await db.commit()
    count = result.rowcount

    await write_audit_log(
        "sessions_bulk_revoked",
        username=username,
        detail=f"reason={reason} count={count}",
    )
    return count


async def cleanup_expired_sessions() -> None:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text("DELETE FROM user_sessions WHERE expires_at <= :now"),
            {"now": now},
        )
        await db.commit()
