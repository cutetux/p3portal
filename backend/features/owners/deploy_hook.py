# p3portal.org
"""PROJ-48: Post-Deploy-Hook für Owner-Auto-Assignment.

Wird aus ansible_runner_service.run_ansible_job() nach erfolgreichem Job aufgerufen.
Schreibt Owner-Eintrag wenn auto_owner_user_id gesetzt und Job erfolgreich.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

DEPLOY_CATEGORIES = frozenset({"vm_deployment", "lxc_deployment"})


async def on_deploy_success(job_id: str) -> None:
    """Haupt-Einstiegspunkt. Wird nach erfolgreichem Ansible-Job aufgerufen.

    Liest auto_owner_user_id + deploy_category + params aus Job.
    Schreibt Owner-Eintrag wenn alle Voraussetzungen erfüllt.
    """
    import json

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT auto_owner_user_id, deploy_category, params, username
                  FROM jobs WHERE id = :id
            """),
            {"id": job_id},
        )
        row = result.mappings().fetchone()

    if row is None:
        logger.warning("PROJ-48: deploy_hook job %s nicht gefunden", job_id)
        return

    auto_owner_user_id = row["auto_owner_user_id"]
    deploy_category = row["deploy_category"]

    # Checkbox war deaktiviert oder kein Deploy-Job
    if auto_owner_user_id is None:
        return
    if deploy_category not in DEPLOY_CATEGORIES:
        return

    try:
        params = json.loads(row["params"] or "{}")
    except (ValueError, TypeError):
        params = {}

    # Extrahiere node_id + vmid aus params
    node_id = await _resolve_node_id(params)
    vmid = _resolve_vmid(params)

    if node_id is None or vmid is None:
        logger.warning(
            "PROJ-48: deploy_hook job %s – node_id oder vmid nicht aufgelöst "
            "(proxmox_node=%r, vm_id=%r). Owner-Eintrag übersprungen.",
            job_id, params.get("proxmox_node"), params.get("vm_id"),
        )
        await write_audit_log(
            "owner_auto_assign_skipped", row["username"], "local",
            detail=f"job {job_id}: node_id oder vmid nicht ermittelt"
        )
        return

    resource_type = "lxc" if deploy_category == "lxc_deployment" else "vm"

    # Dead-User-Check (EC-4)
    async with get_db() as db:
        u_result = await db.execute(
            text("SELECT id, username, active FROM local_users WHERE id = :id"),
            {"id": auto_owner_user_id},
        )
        u_row = u_result.mappings().fetchone()

    if u_row is None or not u_row["active"]:
        logger.warning(
            "PROJ-48: deploy_hook job %s – user %s nicht aktiv. Owner-Eintrag übersprungen.",
            job_id, auto_owner_user_id,
        )
        await write_audit_log(
            "owner_auto_assign_skipped", row["username"], "local",
            detail=f"job {job_id}: user {auto_owner_user_id} deaktiviert oder gelöscht"
        )
        return

    actor_username = u_row["username"]

    # Race-Check (EC-2): Limit erneut prüfen
    from backend.features.owners.service import count_active_ownerships
    max_ownerships = plus_behavior.get_max_ownerships()
    if max_ownerships is not None:
        current = await count_active_ownerships(auto_owner_user_id)
        if current >= max_ownerships:
            logger.warning(
                "PROJ-48: deploy_hook job %s – User %s hat Owner-Limit überschritten "
                "(%s/%s). Soft-Skip nach erfolgreichem Deploy.",
                job_id, auto_owner_user_id, current, max_ownerships,
            )
            await write_audit_log(
                "owner_auto_assign_skipped", actor_username, "local",
                detail=f"job {job_id}: limit_exceeded_after_deploy ({current}/{max_ownerships})"
            )
            return

    # Owner-Eintrag anlegen (EC-3: VMID-Recycling kein Problem wegen partial-UNIQUE)
    async with get_db() as db:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        try:
            await db.execute(
                text("""
                    INSERT INTO vm_owners
                        (resource_type, node_id, vmid, user_id, assigned_at,
                         assigned_by_user_id, source)
                    VALUES (:rt, :nid, :vmid, :uid, :at, :by_uid, 'deploy')
                """),
                {
                    "rt": resource_type, "nid": node_id, "vmid": vmid,
                    "uid": auto_owner_user_id, "at": now, "by_uid": auto_owner_user_id,
                },
            )
            await db.commit()
        except IntegrityError:
            # Schon Owner (z.B. bei parallelem Deploy) – kein Fehler
            logger.info(
                "PROJ-48: deploy_hook job %s – User %s ist bereits Owner (IntegrityError ignoriert)",
                job_id, auto_owner_user_id,
            )
            return

    await write_audit_log(
        "owner_auto_assigned", actor_username, "local",
        detail=f"job {job_id}: Owner eingetragen {resource_type} vmid={vmid} node={node_id}"
    )
    logger.info(
        "PROJ-48: Owner auto-assigned: user=%s %s vmid=%s node=%s",
        auto_owner_user_id, resource_type, vmid, node_id,
    )


async def _resolve_node_id(params: dict) -> int | None:
    """Löst proxmox_node-Name aus params nach node_id auf."""
    node_name = params.get("proxmox_node")
    if not node_name:
        return None

    async with get_db() as db:
        # Direkt nach proxmox_node-Feld suchen
        result = await db.execute(
            text("SELECT id FROM nodes WHERE proxmox_node = :name LIMIT 1"),
            {"name": node_name},
        )
        row = result.fetchone()
        if row:
            return row[0]

        # Fallback: cluster_nodes JSON-Array absuchen
        result2 = await db.execute(text("SELECT id, cluster_nodes FROM nodes"))
        for n_row in result2.fetchall():
            try:
                import json
                cluster_nodes = json.loads(n_row[1] or "[]")
                if node_name in cluster_nodes:
                    return n_row[0]
            except (ValueError, TypeError):
                continue

    return None


def _resolve_vmid(params: dict) -> int | None:
    """Extrahiert vmid aus params (vm_id oder vmid)."""
    for key in ("vm_id", "vmid"):
        val = params.get(key)
        if val is not None:
            try:
                return int(val)
            except (TypeError, ValueError):
                pass
    return None
