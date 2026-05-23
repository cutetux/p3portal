# p3portal.org
"""PROJ-65: Adapter für Alert-Quelle (PROJ-34, alert_events)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.notifications.schemas import NotificationItem, NotificationLink

# alert_events.severity: 'warning' | 'critical' → Notification-Severity
_SEVERITY_MAP = {
    "warning":  "warn",
    "critical": "critical",
}

_METRIC_LABELS = {
    "cpu_percent":  "CPU",
    "mem_percent":  "RAM",
    "disk_percent": "Disk",
    "status":       "Status",
}

_STATE_LABELS = {
    "firing":   "ausgelöst",
    "resolved": "behoben",
}


def _fmt_value(raw: str | None, metric: str) -> str:
    """Decode JSON-encoded value to readable string."""
    if raw is None:
        return "?"
    try:
        v = json.loads(raw)
        if metric == "status":
            return str(v)
        return f"{float(v):.1f}%"
    except (ValueError, TypeError):
        return str(raw)


def _fmt_threshold(raw: str | None, metric: str) -> str:
    if raw is None:
        return "?"
    try:
        v = json.loads(raw)
        if metric == "status":
            return str(v)
        return f"{float(v):.0f}%"
    except (ValueError, TypeError):
        return str(raw)


async def fetch(user, limit: int = 200) -> list[NotificationItem]:
    """
    Alert-Events (state='firing' + zuletzt resolved).
    operator/admin sehen alle; viewer sehen nichts (PROJ-34-Schwelle).
    """
    # Berechtigungsfilter: restricted-Nutzer + Viewer ohne Berechtigungen sehen keine Alerts
    if user.role not in ("admin", "operator"):
        return []

    async with get_db() as session:
        result = await session.execute(
            text(
                """
                SELECT ae.id, ae.rule_name, ae.vmid, ae.vm_name, ae.metric,
                       ae.severity, ae.state, ae.timestamp,
                       ae.value, ae.threshold,
                       ae.vm_type, ae.proxmox_node,
                       nr.read_at
                FROM alert_events ae
                LEFT JOIN notification_reads nr
                    ON nr.user_id = :uid
                   AND nr.source = 'alert'
                   AND nr.source_id = CAST(ae.id AS TEXT)
                ORDER BY
                    (nr.read_at IS NULL) DESC,
                    CASE ae.severity
                        WHEN 'critical' THEN 2
                        WHEN 'warning'  THEN 1
                        ELSE 0
                    END DESC,
                    ae.timestamp DESC
                LIMIT :limit
                """
            ),
            {"uid": user.user_id, "limit": limit},
        )
        rows = result.mappings().fetchall()

    items: list[NotificationItem] = []
    for row in rows:
        ts = row["timestamp"]
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts)
            except ValueError:
                ts = datetime.now(timezone.utc)

        sev = _SEVERITY_MAP.get(row["severity"], "warn")
        vm_label = row["vm_name"] or row["vmid"] or "?"
        title = f"{vm_label}: {row['rule_name']}"

        metric = row["metric"]
        metric_label = _METRIC_LABELS.get(metric, metric)
        value_str = _fmt_value(row["value"], metric)
        threshold_str = _fmt_threshold(row["threshold"], metric)
        state_label = _STATE_LABELS.get(row["state"], row["state"])

        if metric == "status":
            summary = f"{metric_label}: {value_str} · {state_label}"
        else:
            summary = f"{metric_label}: {value_str} (Grenzwert: {threshold_str}) · {state_label}"

        # Link zur VM-Detailseite mit Alerts-Tab
        vm_type = row["vm_type"] or "qemu"
        proxmox_node = row["proxmox_node"] or ""
        if proxmox_node:
            route = f"/vm/{proxmox_node}/{vm_type}/{row['vmid']}?tab=alerts"
        else:
            route = "/announcements?tab=alerts"

        items.append(
            NotificationItem(
                source="alert",
                source_id=str(row["id"]),
                severity=sev,
                title=title[:120],
                summary=summary,
                created_at=ts,
                read=row["read_at"] is not None,
                link=NotificationLink(
                    route=route,
                    params={"alert_id": row["id"]},
                ),
                meta={
                    "alert_event_id": row["id"],
                    "vmid": row["vmid"],
                    "vm_type": vm_type,
                    "proxmox_node": proxmox_node,
                    "metric": metric,
                    "state": row["state"],
                },
            )
        )
    return items
