# p3portal.org
"""PROJ-65: Adapter für Job-Quelle (Ansible + Packer, PROJ-5)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.notifications.schemas import NotificationItem, NotificationLink

# jobs.status → Notification-Severity
_STATUS_SEVERITY = {
    "failed":  "warn",
    "success": "info",
    "running": "info",
    "pending": "info",
}


async def fetch(user, limit: int = 200) -> list[NotificationItem]:
    """
    Eigene Jobs immer sichtbar; fremde nur mit view_logs oder admin-Rolle.
    """
    has_view_logs = (
        user.role == "admin"
        or "view_logs" in (user.portal_permissions or [])
    )

    async with get_db() as session:
        if has_view_logs:
            result = await session.execute(
                text(
                    """
                    SELECT j.id, j.playbook, j.status, j.type, j.username, j.created_at,
                           nr.read_at
                    FROM jobs j
                    LEFT JOIN notification_reads nr
                        ON nr.user_id = :uid
                       AND nr.source = 'event'
                       AND nr.source_id = 'job:' || j.id
                    ORDER BY
                        (nr.read_at IS NULL) DESC,
                        j.created_at DESC
                    LIMIT :limit
                    """
                ),
                {"uid": user.user_id, "limit": limit},
            )
        else:
            result = await session.execute(
                text(
                    """
                    SELECT j.id, j.playbook, j.status, j.type, j.username, j.created_at,
                           nr.read_at
                    FROM jobs j
                    LEFT JOIN notification_reads nr
                        ON nr.user_id = :uid
                       AND nr.source = 'event'
                       AND nr.source_id = 'job:' || j.id
                    WHERE j.username = :username
                    ORDER BY
                        (nr.read_at IS NULL) DESC,
                        j.created_at DESC
                    LIMIT :limit
                    """
                ),
                {"uid": user.user_id, "username": user.username, "limit": limit},
            )
        rows = result.mappings().fetchall()

    items: list[NotificationItem] = []
    for row in rows:
        ts = row["created_at"]
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts)
            except ValueError:
                ts = datetime.now(timezone.utc)

        sev = _STATUS_SEVERITY.get(row["status"], "info")
        job_type = row["type"] or "ansible"
        playbook = row["playbook"] or "?"
        title = f"{job_type.capitalize()}: {playbook}"
        summary = f"Status: {row['status']}, User: {row['username']}"
        source_id = f"job:{row['id']}"

        items.append(
            NotificationItem(
                source="event",
                source_id=source_id,
                severity=sev,
                title=title[:120],
                summary=summary,
                created_at=ts,
                read=row["read_at"] is not None,
                link=NotificationLink(
                    route=f"/events/{row['id']}",
                    modal=None,
                    params={},
                ),
                meta={
                    "sub_source": "job",
                    "job_id": row["id"],
                    "job_type": job_type,
                    "status": row["status"],
                },
            )
        )
    return items
