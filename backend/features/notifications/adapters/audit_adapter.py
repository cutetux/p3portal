# p3portal.org
"""PROJ-65: Adapter für Audit-Log-Quelle (PROJ-23, audit_logs)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.notifications.schemas import NotificationItem, NotificationLink

# Statische Severity-Tabelle (Tech-Design §L)
_AUDIT_SEVERITY: dict[str, str] = {
    "login_failed":         "warn",
    "token_revoked":        "warn",
    "permission_grant":     "info",
    "permission_revoke":    "info",
    "user_created":         "info",
    "user_updated":         "info",
    "user_deleted":         "info",
}
_DEFAULT_SEVERITY = "info"


def _audit_severity(event_type: str) -> str:
    return _AUDIT_SEVERITY.get(event_type, _DEFAULT_SEVERITY)


async def fetch(user, limit: int = 200) -> list[NotificationItem]:
    """Audit-Log nur für Nutzer mit view_logs-Permission oder admin."""
    has_view_logs = (
        user.role == "admin"
        or "view_logs" in (user.portal_permissions or [])
    )
    if not has_view_logs:
        return []

    async with get_db() as session:
        result = await session.execute(
            text(
                """
                SELECT al.id, al.event_type, al.username, al.ip_address, al.created_at,
                       nr.read_at
                FROM audit_logs al
                LEFT JOIN notification_reads nr
                    ON nr.user_id = :uid
                   AND nr.source = 'event'
                   AND nr.source_id = 'audit:' || CAST(al.id AS TEXT)
                ORDER BY
                    (nr.read_at IS NULL) DESC,
                    al.created_at DESC
                LIMIT :limit
                """
            ),
            {"uid": user.user_id, "limit": limit},
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

        sev = _audit_severity(row["event_type"])
        actor = row["username"] or "system"
        title = f"Audit: {row['event_type']}"
        summary = f"User: {actor}"
        source_id = f"audit:{row['id']}"

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
                    route="/logs",
                    modal="audit_detail",
                    params={"audit_id": row["id"]},
                ),
                meta={
                    "sub_source": "audit",
                    "audit_id": row["id"],
                    "event_type": row["event_type"],
                },
            )
        )
    return items
