# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-62: Post-Deploy-Hook für Pool-Auto-Member-Add.

Wird aus PoolsPlusBehavior.on_deploy_success_pool_hook() aufgerufen,
welches wiederum über plus_behavior.on_deploy_success_pool_hook()
aus ansible_runner_service.run_ansible_job() nach erfolgreichem Job getriggert wird.

Schreibt pool_members-Eintrag wenn Job-Parameter pool_id gesetzt haben.
UNIQUE-Konflikt (VM schon im Pool) = Audit-Event, kein Job-Failure (AC-MEM-2).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

DEPLOY_CATEGORIES = frozenset({"vm_deployment", "lxc_deployment"})


async def on_deploy_success_pool_auto_add(job_id: int) -> None:
    """Haupt-Einstiegspunkt: Auto-Member-Add nach erfolgreichem Deploy.

    Liest pool_id + params aus Job. Wenn pool_id gesetzt und Job ein
    VM/LXC-Deploy war, wird der neu deployede VM/LXC zum Pool hinzugefügt.
    """
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT deploy_category, params, username, pool_id
                  FROM jobs WHERE id = :id
            """),
            {"id": job_id},
        )
        row = result.mappings().fetchone()

    if row is None:
        logger.warning("PROJ-62: pool deploy_hook job %s nicht gefunden", job_id)
        return

    pool_id = row.get("pool_id") if row else None
    if not pool_id:
        return  # kein Pool-Kontext → kein Auto-Add nötig

    deploy_category = row.get("deploy_category")
    if deploy_category not in DEPLOY_CATEGORIES:
        return

    try:
        params = json.loads(row["params"] or "{}")
    except (ValueError, TypeError):
        params = {}

    node_id = await _resolve_node_id(params)
    vmid = _resolve_vmid(params)
    username = row.get("username", "system")

    if node_id is None or vmid is None:
        logger.warning(
            "PROJ-62: pool deploy_hook job %s – node_id oder vmid nicht aufgelöst "
            "(proxmox_node=%r, vm_id=%r). Pool-Auto-Add übersprungen.",
            job_id, params.get("proxmox_node"), params.get("vm_id"),
        )
        await write_audit_log(
            "pool_member_auto_add_skipped", username, "local",
            detail=f"job {job_id}: pool_id={pool_id} – node_id oder vmid nicht ermittelt",
        )
        return

    resource_type = "lxc" if deploy_category == "lxc_deployment" else "vm"
    now = datetime.now(timezone.utc).isoformat()

    async with get_db() as db:
        try:
            await db.execute(
                text("""
                    INSERT INTO pool_members
                        (pool_id, resource_type, node_id, vmid, added_at, added_by)
                    VALUES (:pid, :rt, :nid, :vmid, :at, :by)
                """),
                {
                    "pid": pool_id,
                    "rt": resource_type,
                    "nid": node_id,
                    "vmid": vmid,
                    "at": now,
                    "by": username,
                },
            )
            await db.commit()
        except IntegrityError:
            # VM ist bereits Pool-Member (AC-MEM-2: kein Fehler, nur Audit)
            logger.info(
                "PROJ-62: pool deploy_hook job %s – %s vmid=%s node=%s schon in Pool %s (OK)",
                job_id, resource_type, vmid, node_id, pool_id,
            )
            await write_audit_log(
                "pool_member_auto_add_skipped", username, "local",
                detail=f"job {job_id}: {resource_type} vmid={vmid} node={node_id} bereits in pool {pool_id}",
            )
            return

    await write_audit_log(
        "pool_member_auto_added", username, "local",
        detail=f"job {job_id}: {resource_type} vmid={vmid} node={node_id} → pool {pool_id}",
    )
    logger.info(
        "PROJ-62: Pool-Auto-Member-Add: pool=%s %s vmid=%s node=%s job=%s",
        pool_id, resource_type, vmid, node_id, job_id,
    )


async def _resolve_node_id(params: dict) -> int | None:
    """Löst proxmox_node-Name aus params nach node_id auf."""
    node_name = params.get("proxmox_node")
    if not node_name:
        return None

    async with get_db() as db:
        result = await db.execute(
            text("SELECT id FROM nodes WHERE proxmox_node = :name LIMIT 1"),
            {"name": node_name},
        )
        row = result.fetchone()
        if row:
            return row[0]

        # Fallback: cluster_nodes JSON-Array
        result2 = await db.execute(text("SELECT id, cluster_nodes FROM nodes"))
        for n_row in result2.fetchall():
            try:
                cluster_nodes = json.loads(n_row[1] or "[]")
                if node_name in cluster_nodes:
                    return n_row[0]
            except (ValueError, TypeError):
                continue

    return None


def _resolve_vmid(params: dict) -> int | None:
    """Extrahiert vmid aus params (vm_id, vmid oder auto_vmid)."""
    for key in ("vm_id", "vmid", "auto_vmid"):
        val = params.get(key)
        if val is not None:
            try:
                return int(val)
            except (TypeError, ValueError):
                pass
    return None
