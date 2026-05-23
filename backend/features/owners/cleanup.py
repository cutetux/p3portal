# p3portal.org
"""PROJ-48: Cleanup-Hooks für das Owners-Modul.

Hooks:
1. on_user_delete()    – User-Delete: Owner-Einträge übertragen oder verwaisen
2. on_resource_deleted() – VM/LXC gelöscht (Portal-Side)
3. reconcile_with_cluster() – Cluster-Refresh-Diff: verschwundene VMs soft-löschen
4. on_node_delete()    – Node gelöscht: alle Owner-Einträge soft-löschen
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── 1. User-Delete ────────────────────────────────────────────────────────────

async def count_active_ownerships_for_user(user_id: int) -> int:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT COUNT(*) FROM vm_owners WHERE user_id = :uid AND deleted_at IS NULL"),
            {"uid": user_id},
        )
        return result.scalar() or 0


async def on_user_delete(
    user_id: int,
    actor_username: str,
    action: str,           # "transfer" | "orphan"
    transfer_to_user_id: int | None = None,
) -> None:
    """Wird vor dem Löschen eines Users aufgerufen.

    action=transfer: alle Owner-Einträge auf transfer_to_user_id übertragen.
    action=orphan:   alle Owner-Einträge soft-löschen.
    Wirft ValueError wenn action=transfer und kein Ziel-User angegeben.
    """
    if action == "transfer" and transfer_to_user_id is None:
        raise ValueError("transfer_to_user_id ist Pflicht bei action=transfer")

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id, resource_type, node_id, vmid
                  FROM vm_owners
                 WHERE user_id = :uid AND deleted_at IS NULL
            """),
            {"uid": user_id},
        )
        entries = result.mappings().fetchall()

    if not entries:
        return

    now = _now()

    if action == "orphan":
        async with get_db() as db:
            await db.execute(
                text("""
                    UPDATE vm_owners SET deleted_at=:now, deleted_reason='user_deleted'
                     WHERE user_id=:uid AND deleted_at IS NULL
                """),
                {"now": now, "uid": user_id},
            )
            await db.commit()
        for e in entries:
            await write_audit_log(
                "owner_removed", actor_username, "local",
                detail=f"User-Delete-Orphan: {e['resource_type']} vmid={e['vmid']} node={e['node_id']} reason=user_deleted"
            )

    elif action == "transfer":
        for e in entries:
            async with get_db() as db:
                # Alten Eintrag soft-löschen
                await db.execute(
                    text("""
                        UPDATE vm_owners SET deleted_at=:now, deleted_reason='user_deleted'
                         WHERE id=:eid AND deleted_at IS NULL
                    """),
                    {"now": now, "eid": e["id"]},
                )
                # Neuen Eintrag für Ziel-User anlegen
                try:
                    await db.execute(
                        text("""
                            INSERT INTO vm_owners
                                (resource_type, node_id, vmid, user_id, assigned_at,
                                 assigned_by_user_id, source)
                            VALUES (:rt, :nid, :vmid, :uid, :at, :by_uid, 'transfer')
                        """),
                        {
                            "rt": e["resource_type"], "nid": e["node_id"], "vmid": e["vmid"],
                            "uid": transfer_to_user_id, "at": now, "by_uid": None,
                        },
                    )
                except IntegrityError:
                    # Ziel-User ist bereits Owner – nur soft-löschen ist ok
                    logger.info(
                        "PROJ-48: user_delete transfer: Ziel-User %s ist bereits Owner von vmid=%s",
                        transfer_to_user_id, e["vmid"],
                    )
                await db.commit()
            await write_audit_log(
                "owner_transferred", actor_username, "local",
                detail=f"User-Delete-Transfer: from_user={user_id} to_user={transfer_to_user_id} "
                       f"{e['resource_type']} vmid={e['vmid']} node={e['node_id']}"
            )


# ── 2. Resource-Delete ────────────────────────────────────────────────────────

async def on_resource_deleted(
    resource_type: str,
    node_id: int,
    vmid: int,
    actor_username: str = "system",
) -> None:
    """Soft-löscht alle aktiven Owner-Einträge für eine gelöschte Ressource."""
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id FROM vm_owners
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND deleted_at IS NULL
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid},
        )
        entries = result.fetchall()

        if not entries:
            return

        now = _now()
        await db.execute(
            text("""
                UPDATE vm_owners SET deleted_at=:now, deleted_reason='resource_deleted'
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND deleted_at IS NULL
            """),
            {"now": now, "rt": resource_type, "nid": node_id, "vmid": vmid},
        )
        await db.commit()

    await write_audit_log(
        "owner_resource_deleted", actor_username, "local",
        detail=f"Ressource gelöscht: {resource_type} vmid={vmid} node={node_id} "
               f"owner_count={len(entries)}"
    )
    logger.info(
        "PROJ-48: %d Owner-Einträge soft-gelöscht für %s vmid=%s node=%s",
        len(entries), resource_type, vmid, node_id,
    )


# ── 3. Cluster-Refresh-Diff ───────────────────────────────────────────────────

async def reconcile_with_cluster(snapshot: list[dict]) -> None:
    """Vergleicht vm_owners mit Cluster-Snapshot und soft-löscht verschwundene VMs.

    snapshot: Liste von {node_id, vmid, resource_type} (aus Cluster-Cache-Refresh).
    Wird nur aufgerufen wenn Refresh vollständig erfolgreich war (Schutz vor Massenlöschungen).
    """
    # Snapshot-Set bauen
    cluster_set: set[tuple[int, int]] = {(r["node_id"], r["vmid"]) for r in snapshot}

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT DISTINCT resource_type, node_id, vmid
                  FROM vm_owners
                 WHERE deleted_at IS NULL
            """),
        )
        owned = result.fetchall()

    for row in owned:
        rt, nid, vmid = row[0], row[1], row[2]
        if (nid, vmid) not in cluster_set:
            logger.info(
                "PROJ-48: Cluster-Diff: %s vmid=%s node=%s nicht im Snapshot – soft-löschen",
                rt, vmid, nid,
            )
            await on_resource_deleted(rt, nid, vmid, actor_username="cluster_refresh")


async def reconcile_for_node(node_id: int, raw_vms: list[dict]) -> None:
    """Per-Node-Reconcile nach erfolgreichem Cache-Refresh.

    Nur für den angegebenen Node werden Owner-Einträge mit dem frischen Snapshot verglichen.
    Sicherer als reconcile_with_cluster() für partielle Refreshes.
    """
    alive_vmids: set[int] = {int(r["vmid"]) for r in raw_vms if r.get("vmid") is not None}

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT DISTINCT resource_type, vmid
                  FROM vm_owners
                 WHERE node_id = :nid AND deleted_at IS NULL
            """),
            {"nid": node_id},
        )
        owned = result.fetchall()

    for row in owned:
        rt, vmid = row[0], row[1]
        if vmid not in alive_vmids:
            logger.info(
                "PROJ-48: Node-%s Diff: %s vmid=%s nicht mehr vorhanden – soft-löschen",
                node_id, rt, vmid,
            )
            await on_resource_deleted(rt, node_id, vmid, actor_username="cluster_refresh")


# ── 4. Node-Delete ────────────────────────────────────────────────────────────

async def on_node_delete(node_id: int, actor_username: str = "system") -> None:
    """Soft-löscht alle aktiven Owner-Einträge für alle VMs eines gelöschten Nodes."""
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id, resource_type, vmid FROM vm_owners
                 WHERE node_id=:nid AND deleted_at IS NULL
            """),
            {"nid": node_id},
        )
        entries = result.fetchall()

        if not entries:
            return

        now = _now()
        await db.execute(
            text("""
                UPDATE vm_owners SET deleted_at=:now, deleted_reason='node_deleted'
                 WHERE node_id=:nid AND deleted_at IS NULL
            """),
            {"now": now, "nid": node_id},
        )
        await db.commit()

    await write_audit_log(
        "owner_resource_deleted", actor_username, "local",
        detail=f"Node-Delete: node={node_id} owner_entries_removed={len(entries)}"
    )
    logger.info(
        "PROJ-48: %d Owner-Einträge soft-gelöscht bei Node-Delete node_id=%s",
        len(entries), node_id,
    )
