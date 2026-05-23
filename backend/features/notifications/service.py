# p3portal.org
"""PROJ-65: Notification Hub – Service-Schicht.

Orchestriert alle Adapter und schreibt Read-Status in notification_reads.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.notifications.schemas import (
    MarkReadResponse,
    NotificationItem,
    NotificationSummary,
)
from backend.features.notifications.severity import max_severity, severity_rank

logger = logging.getLogger(__name__)

_VALID_TABS = ("alerts", "announcements", "events")


async def fetch_tab(user, tab: str, limit: int = 200) -> list[NotificationItem]:
    """Alle Notification-Items für einen Tab zurückgeben, sortiert."""
    if tab == "alerts":
        from backend.features.notifications.adapters.alert_adapter import fetch as _fetch
        items = await _fetch(user, limit=limit)
    elif tab == "announcements":
        from backend.features.notifications.adapters.announcement_adapter import fetch as _fetch
        items = await _fetch(user, limit=limit)
    elif tab == "events":
        job_items, audit_items, cluster_items = await asyncio.gather(
            _import_and_fetch("job", user, limit),
            _import_and_fetch("audit", user, limit),
            _import_and_fetch("cluster_task", user, limit),
            return_exceptions=True,
        )
        items = []
        for result in (job_items, audit_items, cluster_items):
            if isinstance(result, Exception):
                logger.debug("fetch_tab events adapter error: %s", result)
                continue
            items.extend(result)  # type: ignore[arg-type]
    else:
        return []

    items.sort(
        key=lambda x: (not x.read, severity_rank(x.severity), x.created_at),
        reverse=True,
    )
    return items[:limit]


async def _import_and_fetch(adapter_name: str, user, limit: int) -> list[NotificationItem]:
    if adapter_name == "job":
        from backend.features.notifications.adapters.job_adapter import fetch
    elif adapter_name == "audit":
        from backend.features.notifications.adapters.audit_adapter import fetch
    else:
        from backend.features.notifications.adapters.cluster_task_adapter import fetch
    return await fetch(user, limit=limit)


async def get_unread_summary(user) -> NotificationSummary:
    """Ungelesene Notifications zählen (max. 100 pro Quelle, cap 99+)."""
    alerts_count, announcements_count, events_count = await asyncio.gather(
        _count_unread_alerts(user),
        _count_unread_announcements(user),
        _count_unread_events(user),
        return_exceptions=True,
    )

    def _safe_count(val) -> int:
        if isinstance(val, Exception):
            return 0
        return min(int(val), 100)

    a = _safe_count(alerts_count)
    ann = _safe_count(announcements_count)
    ev = _safe_count(events_count)
    total = min(a + ann + ev, 100)

    # Max-Severity über alle Quellen bestimmen (success zählt nicht für Glocke)
    sev_list: list[str] = []
    if a > 0:
        sev_list.append(await _get_max_alert_severity(user))
    if ann > 0:
        sev_list.append(await _get_max_announcement_severity(user))
    if ev > 0:
        sev_list.append("info")

    ms = max_severity(sev_list) if sev_list else None

    return NotificationSummary(
        alerts=a,
        announcements=ann,
        events=ev,
        total=total,
        max_severity=ms,
    )


async def _count_unread_alerts(user) -> int:
    if user.role not in ("admin", "operator"):
        return 0
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM alert_events ae "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM notification_reads nr "
                "  WHERE nr.user_id = :uid AND nr.source = 'alert' "
                "  AND nr.source_id = CAST(ae.id AS TEXT)"
                ")"
            ),
            {"uid": user.user_id},
        )
        return result.scalar() or 0


async def _count_unread_announcements(user) -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM announcements a "
                "WHERE a.active = 1 AND (a.expires_at IS NULL OR a.expires_at > :now) "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM notification_reads nr "
                "  WHERE nr.user_id = :uid AND nr.source = 'announcement' "
                "  AND nr.source_id = CAST(a.id AS TEXT)"
                ")"
            ),
            {"uid": user.user_id, "now": now},
        )
        return result.scalar() or 0


async def _count_unread_events(user) -> int:
    """Zählt ungelesene Jobs + Audit-Einträge (ohne Cluster-Tasks wegen Proxmox-Latenz)."""
    has_view_logs = (
        user.role == "admin"
        or "view_logs" in (user.portal_permissions or [])
    )
    async with get_db() as session:
        if has_view_logs:
            job_result = await session.execute(
                text(
                    "SELECT COUNT(*) FROM jobs j "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM notification_reads nr "
                    "  WHERE nr.user_id = :uid AND nr.source = 'event' "
                    "  AND nr.source_id = 'job:' || j.id"
                    ") LIMIT 100"
                ),
                {"uid": user.user_id},
            )
            audit_result = await session.execute(
                text(
                    "SELECT COUNT(*) FROM audit_logs al "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM notification_reads nr "
                    "  WHERE nr.user_id = :uid AND nr.source = 'event' "
                    "  AND nr.source_id = 'audit:' || CAST(al.id AS TEXT)"
                    ") LIMIT 100"
                ),
                {"uid": user.user_id},
            )
        else:
            job_result = await session.execute(
                text(
                    "SELECT COUNT(*) FROM jobs j "
                    "WHERE j.username = :username "
                    "AND NOT EXISTS ("
                    "  SELECT 1 FROM notification_reads nr "
                    "  WHERE nr.user_id = :uid AND nr.source = 'event' "
                    "  AND nr.source_id = 'job:' || j.id"
                    ") LIMIT 100"
                ),
                {"uid": user.user_id, "username": user.username},
            )
            audit_result = None

        jobs = job_result.scalar() or 0
        audit = (audit_result.scalar() or 0) if audit_result is not None else 0
        return min(jobs + audit, 100)


async def _get_max_alert_severity(user) -> str:
    """Höchste Severity der ungelesenen Alerts (alert_events.severity: 'warning'|'critical')."""
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT ae.severity FROM alert_events ae "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM notification_reads nr "
                "  WHERE nr.user_id = :uid AND nr.source = 'alert' "
                "  AND nr.source_id = CAST(ae.id AS TEXT)"
                ") "
                "ORDER BY CASE ae.severity "
                "    WHEN 'critical' THEN 2 "
                "    WHEN 'warning'  THEN 1 "
                "    ELSE 0 END DESC "
                "LIMIT 1"
            ),
            {"uid": user.user_id},
        )
        row = result.scalar()
    if row is None:
        return "info"
    return "critical" if row == "critical" else "warn"


async def _get_max_announcement_severity(user) -> str:
    """Höchste Severity der ungelesenen aktiven Announcements."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT a.severity FROM announcements a "
                "WHERE a.active = 1 AND (a.expires_at IS NULL OR a.expires_at > :now) "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM notification_reads nr "
                "  WHERE nr.user_id = :uid AND nr.source = 'announcement' "
                "  AND nr.source_id = CAST(a.id AS TEXT)"
                ") "
                "ORDER BY CASE a.severity "
                "    WHEN 'critical' THEN 4 "
                "    WHEN 'warn'     THEN 3 "
                "    WHEN 'info'     THEN 2 "
                "    WHEN 'success'  THEN 1 "
                "    ELSE 0 END DESC "
                "LIMIT 1"
            ),
            {"uid": user.user_id, "now": now},
        )
        row = result.scalar()
    return row or "info"


async def bulk_mark_read(user, source: str, source_ids: list[str]) -> MarkReadResponse:
    """Alle übergebenen source_ids für den Nutzer als gelesen markieren (UPSERT)."""
    now = datetime.now(timezone.utc).isoformat()
    uid = user.user_id

    async with get_db() as session:
        marked = 0
        for sid in source_ids:
            try:
                await session.execute(
                    text(
                        "INSERT INTO notification_reads (user_id, source, source_id, read_at) "
                        "VALUES (:uid, :source, :sid, :now) "
                        "ON CONFLICT (user_id, source, source_id) DO NOTHING"
                    ),
                    {"uid": uid, "source": source, "sid": sid, "now": now},
                )
                marked += 1
            except Exception as exc:
                logger.debug("bulk_mark_read skip sid=%s: %s", sid, exc)
        await session.commit()

    return MarkReadResponse(marked=marked)
