# p3portal.org
"""PROJ-65: Adapter für Cluster-Task-Quelle (PROJ-40, Proxmox API).

Fan-Out über alle konfigurierten Nodes. Fehler eines einzelnen Nodes werden
stillschweigend ignoriert (EC-2: Cluster offline → Quelle leer, kein Fehler-Banner).
RBAC: operator/admin sehen alle Tasks; viewer nur mit node:view_tasks (PROJ-47).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.notifications.schemas import NotificationItem, NotificationLink

logger = logging.getLogger(__name__)


def _map_status_to_severity(status: str) -> str:
    s = (status or "").lower()
    if s in ("ok", "stopped"):
        return "info"
    if s in ("error", "warning"):
        return "warn"
    return "info"


async def _get_portal_nodes() -> list[dict]:
    """Alle konfigurierten Portal-Nodes aus der DB."""
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT id, name, url, proxmox_node, verify_ssl, "
                "operator_token_id, operator_token_secret, "
                "admin_token_id, admin_token_secret "
                "FROM nodes ORDER BY is_default DESC, id"
            )
        )
        return [dict(r) for r in result.mappings().fetchall()]


async def _fetch_tasks_for_node(
    node_row: dict, user, user_node_ids: set[int], uid: int, limit: int
) -> list[NotificationItem]:
    """Tasks für einen einzelnen Node abrufen und als NotificationItems zurückgeben."""
    node_id = node_row["id"]

    # Berechtigungscheck: operator/admin sehen alle; viewer/restricted nur wenn explizit erlaubt
    if user.role not in ("admin", "operator"):
        if node_id not in user_node_ids:
            return []

    # Token-Wahl: admin > operator
    from backend.services.config_service import decrypt_secret
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient

    tid = node_row.get("admin_token_id") or node_row.get("operator_token_id") or ""
    tsec_enc = node_row.get("admin_token_secret") or node_row.get("operator_token_secret") or ""
    tsec = decrypt_secret(tsec_enc) if tsec_enc else ""

    if not tid or not tsec:
        return []

    client = ProxmoxClient(base_url=node_row["url"], verify_ssl=bool(node_row.get("verify_ssl", 1)))
    auth = ProxmoxAuth(kind="token", value=tid, secret=tsec)
    proxmox_node = node_row["proxmox_node"]

    try:
        raw = await client.get_node_tasks(auth, proxmox_node, limit=limit)
    except Exception as exc:
        logger.debug("cluster_task_adapter: node %s unreachable: %s", proxmox_node, exc)
        return []

    items: list[NotificationItem] = []
    task_source_ids = [f"cluster_task:{t.get('upid', '')}" for t in raw if t.get("upid")]

    # Read-Status per Batch laden
    async with get_db() as session:
        if task_source_ids:
            placeholders = ",".join(f":sid{i}" for i in range(len(task_source_ids)))
            read_result = await session.execute(
                text(
                    f"SELECT source_id FROM notification_reads "
                    f"WHERE user_id = :uid AND source = 'event' "
                    f"AND source_id IN ({placeholders})"
                ),
                {f"sid{i}": sid for i, sid in enumerate(task_source_ids)} | {"uid": uid},
            )
            read_ids = {r[0] for r in read_result.fetchall()}
        else:
            read_ids = set()

    for t in raw:
        upid = t.get("upid", "")
        if not upid:
            continue

        starttime = t.get("starttime")
        ts: datetime
        if starttime:
            try:
                ts = datetime.fromtimestamp(int(starttime), tz=timezone.utc)
            except (ValueError, OSError):
                ts = datetime.now(timezone.utc)
        else:
            ts = datetime.now(timezone.utc)

        task_status = t.get("status", "")
        sev = _map_status_to_severity(task_status)
        task_type = t.get("type", "task")
        task_id = t.get("id", "")
        task_user = t.get("user", "")

        title = f"{task_type}: {task_id or upid[:30]}"
        summary = f"Node: {proxmox_node}, Status: {task_status}, User: {task_user}"
        source_id = f"cluster_task:{upid}"

        items.append(
            NotificationItem(
                source="event",
                source_id=source_id,
                severity=sev,
                title=title[:120],
                summary=summary,
                created_at=ts,
                read=source_id in read_ids,
                link=NotificationLink(
                    route=f"/nodes/{proxmox_node}",
                    modal="cluster_task_detail",
                    params={"upid": upid, "node": proxmox_node},
                ),
                meta={
                    "sub_source": "cluster_task",
                    "upid": upid,
                    "proxmox_node": proxmox_node,
                    "node_id": node_id,
                    "task_type": task_type,
                    "status": task_status,
                },
            )
        )
    return items


async def fetch(user, limit: int = 200) -> list[NotificationItem]:
    """Cluster-Tasks Fan-Out über alle konfigurierten Nodes."""
    if user.role not in ("admin", "operator"):
        # viewer/restricted: node:view_tasks-Check pro Node (PROJ-47)
        if user.user_id is None:
            return []
        try:
            from backend.services.nodes_service import list_nodes
            from backend.services.permissions_resolver import resolve_node_action
            all_nodes = await list_nodes()
            checks = await asyncio.gather(
                *[resolve_node_action(user.user_id, n.id, "node:view_tasks") for n in all_nodes],
                return_exceptions=True,
            )
            user_node_ids: set[int] = {
                n.id for n, allowed in zip(all_nodes, checks)
                if allowed is True
            }
        except Exception:
            return []
        if not user_node_ids:
            return []
    else:
        user_node_ids: set[int] = set()

    try:
        nodes = await _get_portal_nodes()
    except Exception:
        return []

    if not nodes:
        return []

    per_node_limit = min(limit, 50)  # 50 Tasks pro Node, gesamt gecapped auf 200
    tasks = [
        _fetch_tasks_for_node(n, user, user_node_ids, user.user_id, per_node_limit)
        for n in nodes
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_items: list[NotificationItem] = []
    for r in results:
        if isinstance(r, Exception):
            continue
        all_items.extend(r)  # type: ignore[arg-type]

    # Sortierung: ungelesen zuerst, dann Severity desc, dann Zeit desc
    from backend.features.notifications.severity import severity_rank
    all_items.sort(
        key=lambda x: (not x.read, severity_rank(x.severity), x.created_at),
        reverse=True,
    )
    return all_items[:limit]
