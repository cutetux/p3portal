# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-62: Plus-Verhalten für das Pools-Modul.

Implementiert alle 8 Pool-Protocol-Hooks aus plus_protocol.py.
Core-Code darf dieses Modul NIEMALS direkt importieren (AGPL/Plus-Trennung).
Aufruf ausschließlich über plus_behavior.<methode>().
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

from backend.core.plus_protocol import PoolGrant, QuotaResult
from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


class PoolsPlusBehavior:
    """Plus-Verhalten: vollständige Pool-Quotas + unbegrenzte Pools."""

    def can_use_pools_quotas(self) -> bool:
        return True

    def get_max_pools(self) -> int | None:
        return None  # Plus = unbegrenzt

    # ── Pool-Berechtigungen ───────────────────────────────────────────────────

    async def get_pool_permissions(self, user_id: int) -> list[PoolGrant]:
        """Gibt alle Pool-Grants zurück, auf die user_id Zugriff hat.

        Aggregiert Permissions pro (pool_id, node_id, vmid) aus direkten
        User-Assignments und Gruppen-Assignments.
        """
        async with get_db() as db:
            # Direkte User-Assignments
            direct_result = await db.execute(
                text("""
                    SELECT pm.pool_id, pm.node_id, pm.vmid, pm.resource_type, rp.permissions
                      FROM pool_members pm
                      JOIN pool_assignments pa ON pa.pool_id = pm.pool_id
                      JOIN role_presets rp ON rp.id = pa.role_preset_id
                     WHERE pa.subject_type = 'user' AND pa.subject_id = :uid
                """),
                {"uid": user_id},
            )
            rows = direct_result.fetchall()

            # Gruppen-Assignments
            group_result = await db.execute(
                text("""
                    SELECT pm.pool_id, pm.node_id, pm.vmid, pm.resource_type, rp.permissions
                      FROM pool_members pm
                      JOIN pool_assignments pa ON pa.pool_id = pm.pool_id
                      JOIN role_presets rp ON rp.id = pa.role_preset_id
                      JOIN group_members gm ON gm.group_id = pa.subject_id
                     WHERE pa.subject_type = 'group' AND gm.user_id = :uid
                """),
                {"uid": user_id},
            )
            rows = list(rows) + list(group_result.fetchall())

        # Aggregiere Permissions pro (pool_id, node_id, vmid)
        agg: dict[tuple, PoolGrant] = {}
        for pool_id, node_id, vmid, resource_type, perms_json in rows:
            key = (pool_id, node_id, vmid)
            perms = set(json.loads(perms_json or "[]"))
            if key in agg:
                agg[key].permissions = list(set(agg[key].permissions) | perms)
            else:
                agg[key] = PoolGrant(
                    pool_id=pool_id,
                    node_id=node_id,
                    vmid=vmid,
                    resource_type=resource_type or "vm",
                    permissions=list(perms),
                )
        return list(agg.values())

    # ── Quota-Check ───────────────────────────────────────────────────────────

    async def check_pool_quota(
        self, user_id: int, pool_id: int, deploy_request: dict
    ) -> QuotaResult:
        """Prüft ob ein Deploy die Pool-Quotas überschreiten würde.

        deploy_request enthält Job-Parameter (vm_cores/lxc_cores etc.).
        Gibt QuotaResult(allowed=True) zurück wenn kein Pool-Quota verletzt wird.
        """
        from backend.plus.pools import service as pool_service

        # Ressourcenanforderungen aus Deploy-Request extrahieren
        extra_cores = int(
            deploy_request.get("vm_cores")
            or deploy_request.get("lxc_cores")
            or 0
        )
        extra_ram_mb = int(
            deploy_request.get("vm_ram_mb")
            or deploy_request.get("lxc_ram_mb")
            or 0
        )
        extra_disk_gb = int(
            deploy_request.get("vm_disk_gb")
            or deploy_request.get("lxc_disk_gb")
            or 0
        )

        async with get_db() as db:
            pool_result = await db.execute(
                text("SELECT * FROM pools WHERE id = :id"),
                {"id": pool_id},
            )
            pool_row = pool_result.mappings().fetchone()
            if not pool_row:
                return QuotaResult(allowed=True)

            usage = await pool_service._calculate_usage(db, pool_id)

        exceeded: list[str] = []
        if pool_row["vm_count_quota"] > 0 and (usage["vm_count"] + 1) > pool_row["vm_count_quota"]:
            exceeded.append("vm_count")
        if pool_row["cpu_quota"] > 0 and (usage["cpu_used"] + extra_cores) > pool_row["cpu_quota"]:
            exceeded.append("cpu_cores")
        if pool_row["ram_quota_mb"] > 0 and (usage["ram_used"] + extra_ram_mb) > pool_row["ram_quota_mb"]:
            exceeded.append("ram_mb")
        if pool_row["disk_quota_gb"] > 0 and (usage["disk_used"] + extra_disk_gb) > pool_row["disk_quota_gb"]:
            exceeded.append("disk_gb")

        return QuotaResult(
            allowed=len(exceeded) == 0,
            exceeded=exceeded,
            current={
                "vm_count": usage["vm_count"],
                "cpu_cores": usage["cpu_used"],
                "ram_mb": usage["ram_used"],
                "disk_gb": usage["disk_used"],
            },
            requested={
                "vm_count": 1,
                "cpu_cores": extra_cores,
                "ram_mb": extra_ram_mb,
                "disk_gb": extra_disk_gb,
            },
            limit={
                "vm_count": pool_row["vm_count_quota"],
                "cpu_cores": pool_row["cpu_quota"],
                "ram_mb": pool_row["ram_quota_mb"],
                "disk_gb": pool_row["disk_quota_gb"],
            },
            pool_id=pool_id,
        )

    # ── Stale-Check für Sidebar-Pins ──────────────────────────────────────────

    async def get_existing_pool_ids(self, candidate_ids: set[int]) -> set[int]:
        """Gibt die Teilmenge der candidate_ids zurück, die noch in der DB existieren."""
        if not candidate_ids:
            return set()
        async with get_db() as db:
            placeholders = ", ".join(f":pid{i}" for i, _ in enumerate(candidate_ids))
            params = {f"pid{i}": pid for i, pid in enumerate(candidate_ids)}
            result = await db.execute(
                text(f"SELECT id FROM pools WHERE id IN ({placeholders})"),
                params,
            )
            return {row[0] for row in result.fetchall()}

    # ── Cleanup-Hooks ─────────────────────────────────────────────────────────

    async def on_user_deleted_pools(self, user_id: int, actor_username: str) -> int:
        """Bereinigt Pool-Referenzen bei User-Löschung. Gibt Anzahl betroffener Pools zurück."""
        from backend.plus.pools.service import cleanup_user_from_pools

        # Benutzername des zu löschenden Users für Audit
        async with get_db() as db:
            result = await db.execute(
                text("SELECT username FROM local_users WHERE id = :uid"),
                {"uid": user_id},
            )
            row = result.fetchone()
            username = row[0] if row else str(user_id)

        await cleanup_user_from_pools(user_id, username, actor_username)
        return 1

    async def on_group_deleted_pools(self, group_id: int, actor_username: str) -> int:
        """Bereinigt Pool-Referenzen bei Gruppen-Löschung."""
        from backend.plus.pools.service import cleanup_group_from_pools

        await cleanup_group_from_pools(group_id, actor_username)
        return 1

    async def on_node_deleted_pools(self, node_id: int, actor_username: str) -> int:
        """Auditiert und bereinigt Pool-Members bei Node-Löschung.

        pool_members hat FK CASCADE auf nodes.id → DB löscht die Zeilen automatisch.
        Dieser Hook schreibt vorher Audit-Events für alle betroffenen Members.
        """
        async with get_db() as db:
            result = await db.execute(
                text(
                    "SELECT id, pool_id, vmid, resource_type "
                    "FROM pool_members WHERE node_id = :nid"
                ),
                {"nid": node_id},
            )
            affected = result.mappings().fetchall()

        for row in affected:
            await write_audit_log(
                "pool_member_removed",
                username=actor_username,
                detail=json.dumps({
                    "pool_id": row["pool_id"],
                    "node_id": node_id,
                    "vmid": row["vmid"],
                    "resource_type": row["resource_type"],
                    "source": "node_deleted",
                }),
            )
        return len(affected)

    async def on_role_preset_deleted_pools(self, preset_id: int, actor_username: str) -> int:
        """Auditiert Pool-Assignments bei Preset-Löschung.

        pool_assignments hat FK CASCADE auf role_presets.id → DB löscht automatisch.
        Dieser Hook schreibt vorher Audit-Events für alle betroffenen Assignments.
        """
        async with get_db() as db:
            result = await db.execute(
                text(
                    "SELECT id, pool_id, subject_type, subject_id "
                    "FROM pool_assignments WHERE role_preset_id = :pid"
                ),
                {"pid": preset_id},
            )
            affected = result.mappings().fetchall()

        for row in affected:
            await write_audit_log(
                "pool_assignment_removed",
                username=actor_username,
                detail=json.dumps({
                    "pool_id": row["pool_id"],
                    "subject_type": row["subject_type"],
                    "subject_id": row["subject_id"],
                    "removed_by": actor_username,
                    "source": "preset_deleted",
                }),
            )
        return len(affected)

    # ── Post-Deploy-Hook ──────────────────────────────────────────────────────

    async def on_deploy_success_pool_hook(self, job_id: int) -> None:
        """Auto-Member-Add nach erfolgreichem Deploy (AC-MEM-1, AC-MEM-2)."""
        from backend.plus.pools.deploy_hook import on_deploy_success_pool_auto_add

        await on_deploy_success_pool_auto_add(job_id)
