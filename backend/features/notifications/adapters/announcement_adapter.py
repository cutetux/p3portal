# p3portal.org
"""PROJ-65: Adapter für Announcements-Quelle (PROJ-28)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.notifications.schemas import NotificationItem, NotificationLink


async def fetch(user, limit: int = 200) -> list[NotificationItem]:
    """Aktive, nicht abgelaufene Announcements – alle authentifizierten Nutzer sehen sie."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        result = await session.execute(
            text(
                """
                SELECT a.id, a.message, a.severity, a.created_at,
                       nr.read_at
                FROM announcements a
                LEFT JOIN notification_reads nr
                    ON nr.user_id = :uid
                   AND nr.source = 'announcement'
                   AND nr.source_id = CAST(a.id AS TEXT)
                WHERE a.active = 1
                  AND (a.expires_at IS NULL OR a.expires_at > :now)
                ORDER BY
                    (nr.read_at IS NULL) DESC,  -- ungelesen zuerst
                    CASE a.severity
                        WHEN 'critical' THEN 4
                        WHEN 'warn'     THEN 3
                        WHEN 'info'     THEN 2
                        WHEN 'success'  THEN 1
                        ELSE 0
                    END DESC,
                    a.created_at DESC
                LIMIT :limit
                """
            ),
            {"uid": user.user_id, "now": now, "limit": limit},
        )
        rows = result.mappings().fetchall()

    items: list[NotificationItem] = []
    for row in rows:
        created = row["created_at"]
        if isinstance(created, str):
            try:
                created = datetime.fromisoformat(created)
            except ValueError:
                created = datetime.now(timezone.utc)

        items.append(
            NotificationItem(
                source="announcement",
                source_id=str(row["id"]),
                severity=row["severity"] or "info",
                title=row["message"][:120],
                summary=None,
                created_at=created,
                read=row["read_at"] is not None,
                link=NotificationLink(
                    route="/announcements",
                    modal="announcement_detail",
                    params={"announcement_id": row["id"]},
                ),
                meta={"announcement_id": row["id"]},
            )
        )
    return items
