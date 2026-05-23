# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-46: Business-Logik für das Pools-Modul."""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Quota locking ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def _quota_lock(db, pool_id: int):
    """Lock the pool row for the duration of a quota-check + insert.

    PostgreSQL: SELECT ... FOR UPDATE
    SQLite: BEGIN IMMEDIATE is already in effect via aiosqlite's default isolation.
    The row-level lock on pools prevents two concurrent deploys from both passing
    the quota check and both inserting (race condition from AC edge case spec).
    """
    await db.execute(
        text("SELECT id FROM pools WHERE id = :pid FOR UPDATE"),
        {"pid": pool_id},
    )
    yield


# ── Cluster-cache helpers ─────────────────────────────────────────────────────

def _get_vm_resources_from_cache(node_id: int, vmid: int) -> dict | None:
    """Look up a VM's configured resources from the cluster cache.

    Returns dict with keys: cores, memory_mb, disk_gb, template, type
    or None if not found.
    """
    try:
        from backend.services.cluster_cache_service import cluster_cache
        # The cluster cache stores Proxmox resource data per node
        # Try to find the VM in any cached endpoint for this node
        for endpoint in ("vms", "lxc"):
            entry = cluster_cache._entries.get((node_id, endpoint))
            if entry and entry.data:
                for vm in entry.data:
                    if int(vm.get("vmid", 0)) == vmid:
                        return _parse_vm_resources(vm)
        return None
    except Exception:
        return None


def _parse_vm_resources(vm: dict) -> dict:
    """Extract quota-relevant resource values from a Proxmox VM/LXC resource dict."""
    cores = int(vm.get("maxcpu", vm.get("cpus", 1)) or 1)
    # maxmem is in bytes
    memory_mb = int((vm.get("maxmem") or 0) // (1024 * 1024))
    # maxdisk is in bytes
    disk_gb = int((vm.get("maxdisk") or 0) // (1024 * 1024 * 1024))
    template = bool(int(vm.get("template", 0) or 0))
    rtype = vm.get("type", "qemu")
    return {
        "cores": cores,
        "memory_mb": memory_mb,
        "disk_gb": disk_gb,
        "template": template,
        "type": rtype,
    }


# ── Usage calculation ─────────────────────────────────────────────────────────

async def _calculate_usage(db, pool_id: int) -> dict:
    """Calculate current resource usage for a pool from cluster cache.

    Templates are counted separately (not against quota per AC-12).
    """
    members_result = await db.execute(
        text("SELECT node_id, vmid FROM pool_members WHERE pool_id = :pid"),
        {"pid": pool_id},
    )
    members = members_result.fetchall()

    vm_count = 0
    cpu_used = 0
    ram_used = 0
    disk_used = 0
    template_count = 0

    for node_id, vmid in members:
        res = _get_vm_resources_from_cache(node_id, vmid)
        if res is None:
            # VM not in cache yet; count it conservatively with 0 resources
            vm_count += 1
            continue
        if res["template"]:
            template_count += 1
        else:
            vm_count += 1
            cpu_used += res["cores"]
            ram_used += res["memory_mb"]
            disk_used += res["disk_gb"]

    return {
        "vm_count": vm_count,
        "cpu_used": cpu_used,
        "ram_used": ram_used,
        "disk_used": disk_used,
        "template_count": template_count,
    }


# ── Visibility helpers ────────────────────────────────────────────────────────

async def _get_user_pool_ids(db, user_id: int) -> set[int]:
    """Return pool IDs the user can access via direct or group assignment."""
    # Direct user assignments
    direct_result = await db.execute(
        text(
            "SELECT pool_id FROM pool_assignments "
            "WHERE subject_type = 'user' AND subject_id = :uid"
        ),
        {"uid": user_id},
    )
    pool_ids = {row[0] for row in direct_result.fetchall()}

    # Group-based assignments
    group_result = await db.execute(
        text(
            "SELECT pa.pool_id FROM pool_assignments pa "
            "JOIN group_members gm ON gm.group_id = pa.subject_id "
            "WHERE pa.subject_type = 'group' AND gm.user_id = :uid"
        ),
        {"uid": user_id},
    )
    pool_ids.update(row[0] for row in group_result.fetchall())
    return pool_ids


async def _get_user_id_by_username(db, username: str) -> int | None:
    result = await db.execute(
        text("SELECT id FROM local_users WHERE username = :u"),
        {"u": username},
    )
    row = result.fetchone()
    return row[0] if row else None


# ── Pool CRUD ─────────────────────────────────────────────────────────────────

async def list_pools(
    is_manager: bool,
    username: str,
    search: str | None = None,
    no_owner: bool = False,
    tag: str | None = None,
) -> list[dict]:
    """List pools — admins/manage_pools see all; others see only their assigned pools."""
    async with get_db() as db:
        conditions: list[str] = []
        params: dict = {}

        if not is_manager:
            user_id = await _get_user_id_by_username(db, username)
            if user_id is None:
                return []
            pool_ids = await _get_user_pool_ids(db, user_id)
            if not pool_ids:
                return []
            # Use parameterised list
            placeholders = ", ".join(f":pid{i}" for i, _ in enumerate(pool_ids))
            conditions.append(f"p.id IN ({placeholders})")
            for i, pid in enumerate(pool_ids):
                params[f"pid{i}"] = pid

        if search:
            conditions.append("LOWER(p.name) LIKE :search")
            params["search"] = f"%{search.lower()}%"
        if no_owner:
            conditions.append("p.owner_subject_id IS NULL")
        if tag:
            conditions.append("p.tags LIKE :tag")
            params["tag"] = f'%"{tag}"%'

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = (
            f"SELECT p.*, "
            f"(SELECT COUNT(*) FROM pool_members pm WHERE pm.pool_id = p.id) AS member_count, "
            f"(SELECT COUNT(*) FROM pool_assignments pa WHERE pa.pool_id = p.id) AS assignment_count "
            f"FROM pools p "
            f"{where} ORDER BY p.name"
        )
        result = await db.execute(text(sql), params)
        rows = result.mappings().fetchall()
        return [_row_to_pool(r) for r in rows]


async def get_pool(pool_id: int) -> dict | None:
    async with get_db() as db:
        return await _pool_with_details(db, pool_id)


async def get_pool_delete_preview(pool_id: int) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM pools WHERE id = :id"), {"id": pool_id}
        )
        row = result.mappings().fetchone()
        if not row:
            return None
        member_count = await _count_members(db, pool_id)
        assignment_count = await _count_assignments(db, pool_id)
        return {
            "pool_id": pool_id,
            "name": row["name"],
            "member_count": member_count,
            "assignment_count": assignment_count,
        }


async def create_pool(
    name: str,
    description: str | None,
    tags: list[str],
    owner_subject_type: str | None,
    owner_subject_id: int | None,
    cpu_quota: int,
    ram_quota_mb: int,
    disk_quota_gb: int,
    vm_count_quota: int,
    created_by: str,
) -> dict:
    max_pools = plus_behavior.get_max_pools()
    async with get_db() as db:
        if max_pools is not None:
            count_result = await db.execute(text("SELECT COUNT(*) FROM pools"))
            count = count_result.scalar() or 0
            if count >= max_pools:
                raise PermissionError(
                    "Pool-Verwaltung benötigt eine aktive Plus-Lizenz. "
                    "Core-Edition erlaubt keine neuen Pools."
                )

        if owner_subject_type and owner_subject_id is not None:
            await _validate_owner(db, owner_subject_type, owner_subject_id)

        now = _now()
        try:
            result = await db.execute(
                text(
                    "INSERT INTO pools "
                    "(name, description, tags, owner_subject_type, owner_subject_id, "
                    "cpu_quota, ram_quota_mb, disk_quota_gb, vm_count_quota, "
                    "created_at, created_by) "
                    "VALUES (:name, :desc, :tags, :ost, :osid, "
                    ":cpu, :ram, :disk, :vmc, :now, :by) "
                    "RETURNING id"
                ),
                {
                    "name": name,
                    "desc": description,
                    "tags": json.dumps(tags),
                    "ost": owner_subject_type,
                    "osid": owner_subject_id,
                    "cpu": cpu_quota,
                    "ram": ram_quota_mb,
                    "disk": disk_quota_gb,
                    "vmc": vm_count_quota,
                    "now": now,
                    "by": created_by,
                },
            )
            row = result.fetchone()
            pool_id = row[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError(f"Ein Pool mit dem Namen '{name}' existiert bereits.")

    await write_audit_log(
        "pool_created",
        username=created_by,
        detail=json.dumps({"pool_id": pool_id, "name": name, "created_by": created_by}),
    )
    async with get_db() as db:
        return await _pool_with_details(db, pool_id)  # type: ignore[return-value]


async def update_pool(
    pool_id: int,
    name: str | None,
    description: str | None,
    tags: list[str] | None,
    owner_subject_type: str | None,
    owner_subject_id: int | None,
    clear_owner: bool,
    cpu_quota: int | None,
    ram_quota_mb: int | None,
    disk_quota_gb: int | None,
    vm_count_quota: int | None,
    updated_by: str,
) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM pools WHERE id = :id"), {"id": pool_id}
        )
        row = result.mappings().fetchone()
        if not row:
            return None

        updates: list[str] = []
        params: dict = {"id": pool_id}

        # Name change
        if name is not None and name != row["name"]:
            updates.append("name = :name")
            params["name"] = name
            await write_audit_log(
                "pool_renamed",
                username=updated_by,
                detail=json.dumps({
                    "pool_id": pool_id,
                    "old_name": row["name"],
                    "new_name": name,
                }),
            )

        # Meta diff (description + tags)
        diff: dict = {}
        if description is not None and description != row["description"]:
            updates.append("description = :desc")
            params["desc"] = description
            diff["description"] = {"old": row["description"], "new": description}
        if tags is not None and json.dumps(tags) != (row["tags"] or "[]"):
            updates.append("tags = :tags")
            params["tags"] = json.dumps(tags)
            diff["tags"] = {"old": json.loads(row["tags"] or "[]"), "new": tags}
        if diff:
            await write_audit_log(
                "pool_meta_changed",
                username=updated_by,
                detail=json.dumps({"pool_id": pool_id, "diff": diff}),
            )

        # Owner change
        old_ost = row["owner_subject_type"]
        old_osid = row["owner_subject_id"]
        new_ost: str | None = old_ost
        new_osid: int | None = old_osid

        if clear_owner:
            new_ost = None
            new_osid = None
        elif owner_subject_type is not None:
            new_ost = owner_subject_type
            new_osid = owner_subject_id

        if new_ost != old_ost or new_osid != old_osid:
            if new_ost and new_osid is not None:
                await _validate_owner(db, new_ost, new_osid)
            updates.append("owner_subject_type = :ost")
            updates.append("owner_subject_id = :osid")
            params["ost"] = new_ost
            params["osid"] = new_osid
            await write_audit_log(
                "pool_owner_changed",
                username=updated_by,
                detail=json.dumps({
                    "pool_id": pool_id,
                    "old_subject": {"type": old_ost, "id": old_osid},
                    "new_subject": {"type": new_ost, "id": new_osid},
                }),
            )

        # Quota changes
        quota_diff: dict = {}
        for field_name, col_name, new_val in [
            ("cpu_quota", "cpu_quota", cpu_quota),
            ("ram_quota_mb", "ram_quota_mb", ram_quota_mb),
            ("disk_quota_gb", "disk_quota_gb", disk_quota_gb),
            ("vm_count_quota", "vm_count_quota", vm_count_quota),
        ]:
            if new_val is not None and new_val != row[col_name]:
                updates.append(f"{col_name} = :{field_name}")
                params[field_name] = new_val
                quota_diff[field_name] = {"old": row[col_name], "new": new_val}
        if quota_diff:
            await write_audit_log(
                "pool_quota_changed",
                username=updated_by,
                detail=json.dumps({"pool_id": pool_id, "diff": quota_diff}),
            )

        if updates:
            try:
                await db.execute(
                    text(f"UPDATE pools SET {', '.join(updates)} WHERE id = :id"),
                    params,
                )
                await db.commit()
            except IntegrityError:
                await db.rollback()
                raise ValueError(f"Ein Pool mit dem Namen '{name}' existiert bereits.")

        return await _pool_with_details(db, pool_id)


async def delete_pool(pool_id: int, deleted_by: str) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM pools WHERE id = :id"), {"id": pool_id}
        )
        row = result.mappings().fetchone()
        if not row:
            return False

        member_count = await _count_members(db, pool_id)
        assignment_count = await _count_assignments(db, pool_id)

        await db.execute(text("DELETE FROM pools WHERE id = :id"), {"id": pool_id})
        await db.commit()

    await write_audit_log(
        "pool_deleted",
        username=deleted_by,
        detail=json.dumps({
            "pool_id": pool_id,
            "name": row["name"],
            "members_count": member_count,
            "assignments_count": assignment_count,
        }),
    )
    return True


# ── Members ───────────────────────────────────────────────────────────────────

async def add_pool_member(
    pool_id: int,
    resource_type: str,
    node_id: int,
    vmid: int,
    added_by: str,
    source: str = "manual",
) -> dict:
    async with get_db() as db:
        await _assert_pool_exists(db, pool_id)
        now = _now()
        try:
            result = await db.execute(
                text(
                    "INSERT INTO pool_members "
                    "(pool_id, resource_type, node_id, vmid, added_at, added_by) "
                    "VALUES (:pid, :rt, :nid, :vmid, :now, :by) "
                    "RETURNING id"
                ),
                {
                    "pid": pool_id,
                    "rt": resource_type,
                    "nid": node_id,
                    "vmid": vmid,
                    "now": now,
                    "by": added_by,
                },
            )
            row = result.fetchone()
            member_id = row[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            # Find which pool this VM already belongs to
            existing = await db.execute(
                text(
                    "SELECT pool_id FROM pool_members WHERE node_id = :nid AND vmid = :vmid"
                ),
                {"nid": node_id, "vmid": vmid},
            )
            ex_row = existing.fetchone()
            existing_pool = ex_row[0] if ex_row else "?"
            raise ValueError(
                f"VM {vmid} auf Node {node_id} ist bereits Pool {existing_pool} zugeordnet."
            )

    await write_audit_log(
        "pool_member_added",
        username=added_by,
        detail=json.dumps({
            "pool_id": pool_id,
            "resource_type": resource_type,
            "node_id": node_id,
            "vmid": vmid,
            "added_by": added_by,
            "source": source,
        }),
    )
    return {
        "id": member_id,
        "pool_id": pool_id,
        "resource_type": resource_type,
        "node_id": node_id,
        "vmid": vmid,
        "added_at": now,
        "added_by": added_by,
    }


async def bulk_add_pool_members(
    pool_id: int,
    members: list[dict],
    added_by: str,
) -> list[dict]:
    """Add multiple VMs/LXCs to a pool in a single transaction."""
    results: list[dict] = []
    async with get_db() as db:
        await _assert_pool_exists(db, pool_id)
        now = _now()
        for m in members:
            try:
                result = await db.execute(
                    text(
                        "INSERT INTO pool_members "
                        "(pool_id, resource_type, node_id, vmid, added_at, added_by) "
                        "VALUES (:pid, :rt, :nid, :vmid, :now, :by) "
                        "RETURNING id"
                    ),
                    {
                        "pid": pool_id,
                        "rt": m["resource_type"],
                        "nid": m["node_id"],
                        "vmid": m["vmid"],
                        "now": now,
                        "by": added_by,
                    },
                )
                row = result.fetchone()
                results.append({
                    "id": row[0],
                    "pool_id": pool_id,
                    "resource_type": m["resource_type"],
                    "node_id": m["node_id"],
                    "vmid": m["vmid"],
                    "added_at": now,
                    "added_by": added_by,
                })
            except IntegrityError:
                await db.rollback()
                raise ValueError(
                    f"VM {m['vmid']} auf Node {m['node_id']} ist bereits einem Pool zugeordnet."
                )
        await db.commit()

    for m in results:
        await write_audit_log(
            "pool_member_added",
            username=added_by,
            detail=json.dumps({
                "pool_id": pool_id,
                "resource_type": m["resource_type"],
                "node_id": m["node_id"],
                "vmid": m["vmid"],
                "added_by": added_by,
                "source": "manual",
            }),
        )
    return results


async def remove_pool_member(
    pool_id: int,
    node_id: int,
    vmid: int,
    removed_by: str,
    source: str = "manual",
) -> bool:
    async with get_db() as db:
        # Get resource_type for audit log before deleting
        rt_result = await db.execute(
            text(
                "SELECT resource_type FROM pool_members "
                "WHERE pool_id = :pid AND node_id = :nid AND vmid = :vmid"
            ),
            {"pid": pool_id, "nid": node_id, "vmid": vmid},
        )
        rt_row = rt_result.fetchone()
        if not rt_row:
            return False

        result = await db.execute(
            text(
                "DELETE FROM pool_members WHERE pool_id = :pid AND node_id = :nid AND vmid = :vmid"
            ),
            {"pid": pool_id, "nid": node_id, "vmid": vmid},
        )
        await db.commit()
        if result.rowcount == 0:
            return False

    await write_audit_log(
        "pool_member_removed",
        username=removed_by,
        detail=json.dumps({
            "pool_id": pool_id,
            "resource_type": rt_row[0],
            "node_id": node_id,
            "vmid": vmid,
            "removed_by": removed_by,
            "source": source,
        }),
    )
    return True


# ── Assignments ───────────────────────────────────────────────────────────────

async def add_pool_assignment(
    pool_id: int,
    subject_type: str,
    subject_id: int,
    role_preset_id: int,
    added_by: str,
) -> dict:
    async with get_db() as db:
        await _assert_pool_exists(db, pool_id)
        await _validate_preset(db, role_preset_id)

        now = _now()
        # Check for existing assignment (PUT-semantic: replace preset if exists)
        existing_result = await db.execute(
            text(
                "SELECT id, role_preset_id FROM pool_assignments "
                "WHERE pool_id = :pid AND subject_type = :st AND subject_id = :sid"
            ),
            {"pid": pool_id, "st": subject_type, "sid": subject_id},
        )
        existing = existing_result.fetchone()

        if existing:
            old_preset_id = existing[1]
            if old_preset_id == role_preset_id:
                # No change needed; return existing
                return await _get_assignment_row(db, existing[0])

            await db.execute(
                text(
                    "UPDATE pool_assignments SET role_preset_id = :rpid, added_at = :now, added_by = :by "
                    "WHERE id = :id"
                ),
                {"rpid": role_preset_id, "now": now, "by": added_by, "id": existing[0]},
            )
            await db.commit()
            await write_audit_log(
                "pool_assignment_changed",
                username=added_by,
                detail=json.dumps({
                    "pool_id": pool_id,
                    "subject_type": subject_type,
                    "subject_id": subject_id,
                    "old_preset_id": old_preset_id,
                    "new_preset_id": role_preset_id,
                    "changed_by": added_by,
                }),
            )
            return await _get_assignment_row(db, existing[0])

        try:
            result = await db.execute(
                text(
                    "INSERT INTO pool_assignments "
                    "(pool_id, subject_type, subject_id, role_preset_id, added_at, added_by) "
                    "VALUES (:pid, :st, :sid, :rpid, :now, :by) "
                    "RETURNING id"
                ),
                {
                    "pid": pool_id,
                    "st": subject_type,
                    "sid": subject_id,
                    "rpid": role_preset_id,
                    "now": now,
                    "by": added_by,
                },
            )
            row = result.fetchone()
            assignment_id = row[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Zuweisung existiert bereits.")

    await write_audit_log(
        "pool_assignment_added",
        username=added_by,
        detail=json.dumps({
            "pool_id": pool_id,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "role_preset_id": role_preset_id,
            "added_by": added_by,
        }),
    )
    async with get_db() as db:
        return await _get_assignment_row(db, assignment_id)


async def remove_pool_assignment(
    pool_id: int,
    subject_type: str,
    subject_id: int,
    removed_by: str,
    source: str = "manual",
) -> bool:
    async with get_db() as db:
        # Get preset_id for audit before deleting
        existing_result = await db.execute(
            text(
                "SELECT id, role_preset_id FROM pool_assignments "
                "WHERE pool_id = :pid AND subject_type = :st AND subject_id = :sid"
            ),
            {"pid": pool_id, "st": subject_type, "sid": subject_id},
        )
        existing = existing_result.fetchone()
        if not existing:
            return False

        await db.execute(
            text(
                "DELETE FROM pool_assignments "
                "WHERE pool_id = :pid AND subject_type = :st AND subject_id = :sid"
            ),
            {"pid": pool_id, "st": subject_type, "sid": subject_id},
        )
        await db.commit()

    await write_audit_log(
        "pool_assignment_removed",
        username=removed_by,
        detail=json.dumps({
            "pool_id": pool_id,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "removed_by": removed_by,
            "source": source,
        }),
    )
    return True


# ── Usage / Quota ─────────────────────────────────────────────────────────────

async def get_pool_usage(pool_id: int) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM pools WHERE id = :id"), {"id": pool_id}
        )
        row = result.mappings().fetchone()
        if not row:
            return None

        usage = await _calculate_usage(db, pool_id)

    def _q(used: int, quota: int) -> dict:
        return {"used": used, "quota": quota}

    is_over = False
    if row["vm_count_quota"] > 0 and usage["vm_count"] > row["vm_count_quota"]:
        is_over = True
    if row["cpu_quota"] > 0 and usage["cpu_used"] > row["cpu_quota"]:
        is_over = True
    if row["ram_quota_mb"] > 0 and usage["ram_used"] > row["ram_quota_mb"]:
        is_over = True
    if row["disk_quota_gb"] > 0 and usage["disk_used"] > row["disk_quota_gb"]:
        is_over = True

    return {
        "pool_id": pool_id,
        "vm_count": _q(usage["vm_count"], row["vm_count_quota"]),
        "cpu": _q(usage["cpu_used"], row["cpu_quota"]),
        "ram_mb": _q(usage["ram_used"], row["ram_quota_mb"]),
        "disk_gb": _q(usage["disk_used"], row["disk_quota_gb"]),
        "template_count": usage["template_count"],
        "is_over_quota": is_over,
    }


async def check_and_lock_quota(
    db,
    pool_id: int,
    extra_cores: int,
    extra_ram_mb: int,
    extra_disk_gb: int,
    extra_vm_count: int,
    username: str,
    action: str,
) -> None:
    """Check quota within a locked transaction. Raises PermissionError on violation.

    The _quota_lock context manager must have been entered before calling this.
    """
    row_result = await db.execute(
        text("SELECT * FROM pools WHERE id = :id"), {"id": pool_id}
    )
    row = row_result.mappings().fetchone()
    if not row:
        raise KeyError(f"Pool {pool_id} nicht gefunden")

    usage = await _calculate_usage(db, pool_id)
    exceeded: list[str] = []

    if row["vm_count_quota"] > 0 and (usage["vm_count"] + extra_vm_count) > row["vm_count_quota"]:
        exceeded.append("vm_count")
    if row["cpu_quota"] > 0 and (usage["cpu_used"] + extra_cores) > row["cpu_quota"]:
        exceeded.append("cpu")
    if row["ram_quota_mb"] > 0 and (usage["ram_used"] + extra_ram_mb) > row["ram_quota_mb"]:
        exceeded.append("ram_mb")
    if row["disk_quota_gb"] > 0 and (usage["disk_used"] + extra_disk_gb) > row["disk_quota_gb"]:
        exceeded.append("disk_gb")

    if exceeded:
        await write_audit_log(
            "pool_quota_exceeded_attempt",
            username=username,
            detail=json.dumps({
                "pool_id": pool_id,
                "user": username,
                "action": action,
                "exceeded": exceeded,
                "requested": {
                    "vm_count": extra_vm_count,
                    "cpu": extra_cores,
                    "ram_mb": extra_ram_mb,
                    "disk_gb": extra_disk_gb,
                },
            }),
        )
        raise PermissionError(json.dumps({
            "error": "pool_quota_exceeded",
            "pool_id": pool_id,
            "exceeded": exceeded,
        }))


# ── Pool-move for a VM ────────────────────────────────────────────────────────

async def move_vm_pool(
    node_id: int,
    vmid: int,
    new_pool_id: int | None,
    moved_by: str,
) -> dict | None:
    """Atomically move or remove a VM from its pool."""
    async with get_db() as db:
        # Check current membership
        existing_result = await db.execute(
            text(
                "SELECT id, pool_id, resource_type FROM pool_members "
                "WHERE node_id = :nid AND vmid = :vmid"
            ),
            {"nid": node_id, "vmid": vmid},
        )
        existing = existing_result.mappings().fetchone()
        old_pool_id = existing["pool_id"] if existing else None
        resource_type = existing["resource_type"] if existing else "vm"

        if new_pool_id is None:
            # Remove from pool
            if existing is None:
                return None
            await db.execute(
                text(
                    "DELETE FROM pool_members WHERE node_id = :nid AND vmid = :vmid"
                ),
                {"nid": node_id, "vmid": vmid},
            )
            await db.commit()
            await write_audit_log(
                "pool_member_removed",
                username=moved_by,
                detail=json.dumps({
                    "pool_id": old_pool_id,
                    "resource_type": resource_type,
                    "node_id": node_id,
                    "vmid": vmid,
                    "removed_by": moved_by,
                    "source": "move",
                }),
            )
            return {"node_id": node_id, "vmid": vmid, "pool_id": None}

        # Validate target pool exists
        pool_check = await db.execute(
            text("SELECT id FROM pools WHERE id = :id"), {"id": new_pool_id}
        )
        if not pool_check.fetchone():
            raise KeyError(f"Pool {new_pool_id} nicht gefunden")

        now = _now()
        if existing:
            if existing["pool_id"] == new_pool_id:
                return {"node_id": node_id, "vmid": vmid, "pool_id": new_pool_id}
            # Update pool_id
            await db.execute(
                text(
                    "UPDATE pool_members SET pool_id = :pid, added_at = :now, added_by = :by "
                    "WHERE node_id = :nid AND vmid = :vmid"
                ),
                {"pid": new_pool_id, "now": now, "by": moved_by, "nid": node_id, "vmid": vmid},
            )
        else:
            # Insert fresh – need resource_type from proxmox data
            rt_result = _get_vm_resources_from_cache(node_id, vmid)
            rtype = "lxc" if (rt_result and rt_result.get("type") == "lxc") else "vm"
            await db.execute(
                text(
                    "INSERT INTO pool_members "
                    "(pool_id, resource_type, node_id, vmid, added_at, added_by) "
                    "VALUES (:pid, :rt, :nid, :vmid, :now, :by)"
                ),
                {
                    "pid": new_pool_id,
                    "rt": rtype,
                    "nid": node_id,
                    "vmid": vmid,
                    "now": now,
                    "by": moved_by,
                },
            )
        await db.commit()

    if old_pool_id and old_pool_id != new_pool_id:
        await write_audit_log(
            "pool_member_removed",
            username=moved_by,
            detail=json.dumps({
                "pool_id": old_pool_id,
                "resource_type": resource_type,
                "node_id": node_id,
                "vmid": vmid,
                "removed_by": moved_by,
                "source": "move",
            }),
        )
    await write_audit_log(
        "pool_member_added",
        username=moved_by,
        detail=json.dumps({
            "pool_id": new_pool_id,
            "resource_type": resource_type,
            "node_id": node_id,
            "vmid": vmid,
            "added_by": moved_by,
            "source": "move",
        }),
    )
    return {"node_id": node_id, "vmid": vmid, "pool_id": new_pool_id}


# ── User-facing pool list ─────────────────────────────────────────────────────

async def get_my_pools(username: str) -> list[dict]:
    """Return pool list for the current user (for deploy dropdown + dashboard filter)."""
    async with get_db() as db:
        user_id = await _get_user_id_by_username(db, username)
        if user_id is None:
            return []

        # Direct user assignments
        direct_result = await db.execute(
            text(
                "SELECT pa.pool_id, pa.role_preset_id, p.name AS pool_name, "
                "rp.name AS preset_name "
                "FROM pool_assignments pa "
                "JOIN pools p ON p.id = pa.pool_id "
                "LEFT JOIN role_presets rp ON rp.id = pa.role_preset_id "
                "WHERE pa.subject_type = 'user' AND pa.subject_id = :uid "
                "ORDER BY p.name"
            ),
            {"uid": user_id},
        )
        direct = direct_result.mappings().fetchall()

        # Group-based assignments
        group_result = await db.execute(
            text(
                "SELECT pa.pool_id, pa.role_preset_id, p.name AS pool_name, "
                "rp.name AS preset_name "
                "FROM pool_assignments pa "
                "JOIN pools p ON p.id = pa.pool_id "
                "LEFT JOIN role_presets rp ON rp.id = pa.role_preset_id "
                "JOIN group_members gm ON gm.group_id = pa.subject_id "
                "WHERE pa.subject_type = 'group' AND gm.user_id = :uid "
                "ORDER BY p.name"
            ),
            {"uid": user_id},
        )
        group_rows = group_result.mappings().fetchall()

        seen: set[int] = set()
        pools: list[dict] = []
        for r in list(direct) + list(group_rows):
            pid = r["pool_id"]
            if pid not in seen:
                seen.add(pid)
                pools.append({
                    "id": pid,
                    "name": r["pool_name"],
                    "role_preset_id": r["role_preset_id"],
                    "role_preset_name": r["preset_name"],
                })
        return sorted(pools, key=lambda x: x["name"])


# ── Tags pool ─────────────────────────────────────────────────────────────────

async def get_tags_pool() -> list[str]:
    async with get_db() as db:
        result = await db.execute(text("SELECT tags FROM pools WHERE tags != '[]'"))
        rows = result.fetchall()

    seen: set[str] = set()
    tags: list[str] = []
    for row in rows:
        for tag in json.loads(row[0] or "[]"):
            lower = tag.lower()
            if lower not in seen:
                seen.add(lower)
                tags.append(tag)
    return sorted(tags)


# ── Auto-sync hook (PROJ-33 cluster poll) ────────────────────────────────────

async def sync_orphan_members(cluster_resources: list[dict]) -> None:
    """Remove pool_members entries whose VM/LXC no longer exists in the cluster.

    Called from the cluster cache refresh hook (AC-43).
    cluster_resources: flat list of Proxmox resource dicts with at least
                       'vmid', 'node' (name), 'type' fields.
    """
    # Build a set of (node_proxmox_name, vmid) pairs that currently exist
    live_vmids: set[tuple[str, int]] = set()
    for res in cluster_resources:
        if res.get("type") in ("qemu", "lxc"):
            live_vmids.add((str(res.get("node", "")), int(res.get("vmid", 0))))

    # Map portal node_id → proxmox_node name
    try:
        async with get_db() as db:
            node_result = await db.execute(
                text("SELECT id, proxmox_node FROM nodes")
            )
            node_rows = node_result.fetchall()
            node_map: dict[int, str] = {row[0]: row[1] for row in node_rows}

            member_result = await db.execute(
                text(
                    "SELECT id, pool_id, resource_type, node_id, vmid "
                    "FROM pool_members"
                )
            )
            members = member_result.mappings().fetchall()

        orphans: list[dict] = []
        for m in members:
            node_name = node_map.get(m["node_id"], "")
            if (node_name, m["vmid"]) not in live_vmids:
                orphans.append(dict(m))

        if not orphans:
            return

        async with get_db() as db:
            for orphan in orphans:
                await db.execute(
                    text("DELETE FROM pool_members WHERE id = :id"),
                    {"id": orphan["id"]},
                )
            await db.commit()

        for orphan in orphans:
            await write_audit_log(
                "pool_member_removed",
                username="system",
                detail=json.dumps({
                    "pool_id": orphan["pool_id"],
                    "resource_type": orphan["resource_type"],
                    "node_id": orphan["node_id"],
                    "vmid": orphan["vmid"],
                    "removed_by": "system",
                    "source": "auto_sync",
                }),
            )
            logger.info(
                "PROJ-46: Auto-sync removed orphan member vmid=%s node_id=%s pool_id=%s",
                orphan["vmid"],
                orphan["node_id"],
                orphan["pool_id"],
            )
    except Exception:
        logger.exception("PROJ-46: sync_orphan_members failed")


# ── Cleanup hooks (user / group deletion) ────────────────────────────────────

async def cleanup_user_from_pools(user_id: int, username: str, deleted_by: str) -> None:
    """Nullify owner references and write audit for assignment cascade before user deletion."""
    async with get_db() as db:
        # Audit assignments that will be cascaded
        asgn_result = await db.execute(
            text(
                "SELECT pool_id FROM pool_assignments "
                "WHERE subject_type = 'user' AND subject_id = :uid"
            ),
            {"uid": user_id},
        )
        asgn_rows = asgn_result.fetchall()

        # Owner cleanup (no DB cascade on polymorphic FK)
        owner_result = await db.execute(
            text(
                "SELECT id, name FROM pools "
                "WHERE owner_subject_type = 'user' AND owner_subject_id = :uid"
            ),
            {"uid": user_id},
        )
        owner_rows = owner_result.mappings().fetchall()

        await db.execute(
            text(
                "UPDATE pools SET owner_subject_type = NULL, owner_subject_id = NULL "
                "WHERE owner_subject_type = 'user' AND owner_subject_id = :uid"
            ),
            {"uid": user_id},
        )
        await db.commit()

    for row in asgn_rows:
        await write_audit_log(
            "pool_assignment_removed",
            username=deleted_by,
            detail=json.dumps({
                "pool_id": row[0],
                "subject_type": "user",
                "subject_id": user_id,
                "removed_by": deleted_by,
                "source": "user_deleted",
            }),
        )
    for row in owner_rows:
        await write_audit_log(
            "pool_owner_deleted",
            username=deleted_by,
            detail=json.dumps({
                "pool_id": row["id"],
                "old_subject": {"type": "user", "id": user_id},
                "new_subject": {"type": None, "id": None},
                "source": "user_deleted",
            }),
        )


async def cleanup_group_from_pools(group_id: int, deleted_by: str) -> None:
    """Nullify owner references and audit for group assignment cascade before group deletion."""
    async with get_db() as db:
        asgn_result = await db.execute(
            text(
                "SELECT pool_id FROM pool_assignments "
                "WHERE subject_type = 'group' AND subject_id = :gid"
            ),
            {"gid": group_id},
        )
        asgn_rows = asgn_result.fetchall()

        owner_result = await db.execute(
            text(
                "SELECT id, name FROM pools "
                "WHERE owner_subject_type = 'group' AND owner_subject_id = :gid"
            ),
            {"gid": group_id},
        )
        owner_rows = owner_result.mappings().fetchall()

        await db.execute(
            text(
                "UPDATE pools SET owner_subject_type = NULL, owner_subject_id = NULL "
                "WHERE owner_subject_type = 'group' AND owner_subject_id = :gid"
            ),
            {"gid": group_id},
        )
        await db.commit()

    for row in asgn_rows:
        await write_audit_log(
            "pool_assignment_removed",
            username=deleted_by,
            detail=json.dumps({
                "pool_id": row[0],
                "subject_type": "group",
                "subject_id": group_id,
                "removed_by": deleted_by,
                "source": "group_deleted",
            }),
        )
    for row in owner_rows:
        await write_audit_log(
            "pool_owner_deleted",
            username=deleted_by,
            detail=json.dumps({
                "pool_id": row["id"],
                "old_subject": {"type": "group", "id": group_id},
                "new_subject": {"type": None, "id": None},
                "source": "group_deleted",
            }),
        )


# ── Private helpers ───────────────────────────────────────────────────────────

def _row_to_pool(r) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "tags": json.loads(r["tags"] or "[]"),
        "owner_subject_type": r["owner_subject_type"],
        "owner_subject_id": r["owner_subject_id"],
        "cpu_quota": r["cpu_quota"],
        "ram_quota_mb": r["ram_quota_mb"],
        "disk_quota_gb": r["disk_quota_gb"],
        "vm_count_quota": r["vm_count_quota"],
        "member_count": r.get("member_count", 0),
        "assignment_count": r.get("assignment_count", 0),
        "created_at": r["created_at"],
        "created_by": r["created_by"],
    }


async def _pool_with_details(db, pool_id: int) -> dict | None:
    result = await db.execute(
        text(
            "SELECT p.*, "
            "(SELECT COUNT(*) FROM pool_members pm WHERE pm.pool_id = p.id) AS member_count, "
            "(SELECT COUNT(*) FROM pool_assignments pa WHERE pa.pool_id = p.id) AS assignment_count "
            "FROM pools p WHERE p.id = :id"
        ),
        {"id": pool_id},
    )
    row = result.mappings().fetchone()
    if not row:
        return None

    pool = _row_to_pool(row)

    members_result = await db.execute(
        text(
            "SELECT id, pool_id, resource_type, node_id, vmid, added_at, added_by "
            "FROM pool_members WHERE pool_id = :pid ORDER BY added_at"
        ),
        {"pid": pool_id},
    )
    pool["members"] = [dict(m) for m in members_result.mappings().fetchall()]

    asgn_result = await db.execute(
        text(
            "SELECT pa.id, pa.pool_id, pa.subject_type, pa.subject_id, "
            "pa.role_preset_id, rp.name AS role_preset_name, "
            "pa.added_at, pa.added_by "
            "FROM pool_assignments pa "
            "LEFT JOIN role_presets rp ON rp.id = pa.role_preset_id "
            "WHERE pa.pool_id = :pid ORDER BY pa.added_at"
        ),
        {"pid": pool_id},
    )
    pool["assignments"] = [dict(a) for a in asgn_result.mappings().fetchall()]
    pool["usage"] = None  # Populated separately via get_pool_usage if needed
    return pool


async def _count_members(db, pool_id: int) -> int:
    result = await db.execute(
        text("SELECT COUNT(*) FROM pool_members WHERE pool_id = :pid"),
        {"pid": pool_id},
    )
    return result.scalar() or 0


async def _count_assignments(db, pool_id: int) -> int:
    result = await db.execute(
        text("SELECT COUNT(*) FROM pool_assignments WHERE pool_id = :pid"),
        {"pid": pool_id},
    )
    return result.scalar() or 0


async def _assert_pool_exists(db, pool_id: int) -> None:
    result = await db.execute(
        text("SELECT id FROM pools WHERE id = :id"), {"id": pool_id}
    )
    if not result.fetchone():
        raise KeyError(f"Pool {pool_id} nicht gefunden")


async def _validate_owner(db, owner_type: str, owner_id: int) -> None:
    if owner_type == "user":
        r = await db.execute(
            text("SELECT id FROM local_users WHERE id = :id"), {"id": owner_id}
        )
        if not r.fetchone():
            raise ValueError(f"Nutzer mit ID {owner_id} nicht gefunden")
    elif owner_type == "group":
        r = await db.execute(
            text("SELECT id FROM groups WHERE id = :id"), {"id": owner_id}
        )
        if not r.fetchone():
            raise ValueError(f"Gruppe mit ID {owner_id} nicht gefunden")


async def _validate_preset(db, preset_id: int) -> None:
    r = await db.execute(
        text("SELECT id FROM role_presets WHERE id = :id"), {"id": preset_id}
    )
    if not r.fetchone():
        raise ValueError(f"Rollenpreset mit ID {preset_id} nicht gefunden")


async def _get_assignment_row(db, assignment_id: int) -> dict:
    result = await db.execute(
        text(
            "SELECT pa.id, pa.pool_id, pa.subject_type, pa.subject_id, "
            "pa.role_preset_id, rp.name AS role_preset_name, "
            "pa.added_at, pa.added_by "
            "FROM pool_assignments pa "
            "LEFT JOIN role_presets rp ON rp.id = pa.role_preset_id "
            "WHERE pa.id = :id"
        ),
        {"id": assignment_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else {}
