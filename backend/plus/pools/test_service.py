# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-46: Unit-Tests für den Pools-Service."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.plus.pools import service

pytestmark = pytest.mark.plus_only


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_pool_row(**kwargs) -> MagicMock:
    defaults = {
        "id": 1,
        "name": "TestPool",
        "description": None,
        "tags": "[]",
        "owner_subject_type": None,
        "owner_subject_id": None,
        "cpu_quota": 0,
        "ram_quota_mb": 0,
        "disk_quota_gb": 0,
        "vm_count_quota": 0,
        "created_at": "2026-01-01T00:00:00+00:00",
        "created_by": "admin",
        "member_count": 0,
        "assignment_count": 0,
    }
    defaults.update(kwargs)
    row = MagicMock()
    row.__getitem__ = lambda self, k: defaults[k]
    row.get = lambda k, d=None: defaults.get(k, d)
    # Support mappings protocol
    row.keys = lambda: defaults.keys()
    return row


# ── _row_to_pool ──────────────────────────────────────────────────────────────

def test_row_to_pool_defaults():
    row = _make_pool_row()
    result = service._row_to_pool(row)
    assert result["id"] == 1
    assert result["name"] == "TestPool"
    assert result["tags"] == []
    assert result["cpu_quota"] == 0


def test_row_to_pool_with_tags():
    row = _make_pool_row(tags='["alpha","beta"]')
    result = service._row_to_pool(row)
    assert result["tags"] == ["alpha", "beta"]


# ── _parse_vm_resources ───────────────────────────────────────────────────────

def test_parse_vm_resources_basic():
    vm = {"maxcpu": 4, "maxmem": 4 * 1024 * 1024 * 1024, "maxdisk": 50 * 1024 * 1024 * 1024, "template": 0, "type": "qemu"}
    res = service._parse_vm_resources(vm)
    assert res["cores"] == 4
    assert res["memory_mb"] == 4096
    assert res["disk_gb"] == 50
    assert res["template"] is False


def test_parse_vm_resources_template():
    vm = {"maxcpu": 2, "maxmem": 2 * 1024 * 1024 * 1024, "maxdisk": 0, "template": 1, "type": "qemu"}
    res = service._parse_vm_resources(vm)
    assert res["template"] is True


def test_parse_vm_resources_defaults():
    res = service._parse_vm_resources({})
    assert res["cores"] == 1
    assert res["memory_mb"] == 0
    assert res["disk_gb"] == 0
    assert res["template"] is False


# ── get_pool_usage (Pydantic construction) ────────────────────────────────────

@pytest.mark.asyncio
async def test_get_pool_usage_unlimited_quotas():
    """Pool with 0 quotas (unlimited) should never be over_quota."""
    pool_row = {
        "id": 1,
        "vm_count_quota": 0,
        "cpu_quota": 0,
        "ram_quota_mb": 0,
        "disk_quota_gb": 0,
    }
    fake_usage = {
        "vm_count": 10,
        "cpu_used": 40,
        "ram_used": 16384,
        "disk_used": 200,
        "template_count": 2,
    }

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    # Simulate pool row query
    pool_result = MagicMock()
    pool_result.mappings.return_value.fetchone.return_value = pool_row
    mock_db.execute.return_value = pool_result

    with (
        patch("backend.plus.pools.service.get_db") as mock_get_db,
        patch("backend.plus.pools.service._calculate_usage", return_value=fake_usage),
    ):
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_db)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_db.return_value = ctx

        usage = await service.get_pool_usage(1)

    assert usage is not None
    assert usage["is_over_quota"] is False
    assert usage["vm_count"]["used"] == 10
    assert usage["vm_count"]["quota"] == 0
    assert usage["template_count"] == 2


@pytest.mark.asyncio
async def test_get_pool_usage_over_quota():
    pool_row = {
        "id": 1,
        "vm_count_quota": 5,
        "cpu_quota": 10,
        "ram_quota_mb": 8192,
        "disk_quota_gb": 100,
    }
    fake_usage = {
        "vm_count": 6,   # over vm_count_quota
        "cpu_used": 8,
        "ram_used": 4096,
        "disk_used": 50,
        "template_count": 0,
    }

    mock_db = AsyncMock()
    pool_result = MagicMock()
    pool_result.mappings.return_value.fetchone.return_value = pool_row
    mock_db.execute.return_value = pool_result

    with (
        patch("backend.plus.pools.service.get_db") as mock_get_db,
        patch("backend.plus.pools.service._calculate_usage", return_value=fake_usage),
    ):
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_db)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_db.return_value = ctx

        usage = await service.get_pool_usage(1)

    assert usage is not None
    assert usage["is_over_quota"] is True


@pytest.mark.asyncio
async def test_get_pool_usage_not_found():
    mock_db = AsyncMock()
    pool_result = MagicMock()
    pool_result.mappings.return_value.fetchone.return_value = None
    mock_db.execute.return_value = pool_result

    with patch("backend.plus.pools.service.get_db") as mock_get_db:
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_db)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_db.return_value = ctx

        usage = await service.get_pool_usage(999)

    assert usage is None


# ── check_and_lock_quota ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_check_quota_passes_under_limit():
    pool_row = {
        "vm_count_quota": 10,
        "cpu_quota": 40,
        "ram_quota_mb": 32768,
        "disk_quota_gb": 500,
    }
    fake_usage = {"vm_count": 3, "cpu_used": 12, "ram_used": 8192, "disk_used": 100, "template_count": 0}

    mock_db = AsyncMock()
    pool_result = MagicMock()
    pool_result.mappings.return_value.fetchone.return_value = pool_row
    mock_db.execute.return_value = pool_result

    with patch("backend.plus.pools.service._calculate_usage", return_value=fake_usage):
        # Should not raise
        await service.check_and_lock_quota(
            mock_db, pool_id=1,
            extra_cores=2, extra_ram_mb=2048, extra_disk_gb=20, extra_vm_count=1,
            username="alice", action="deploy",
        )


@pytest.mark.asyncio
async def test_check_quota_fails_over_vm_count():
    pool_row = {
        "vm_count_quota": 3,
        "cpu_quota": 0,
        "ram_quota_mb": 0,
        "disk_quota_gb": 0,
    }
    fake_usage = {"vm_count": 3, "cpu_used": 4, "ram_used": 2048, "disk_used": 20, "template_count": 0}

    mock_db = AsyncMock()
    pool_result = MagicMock()
    pool_result.mappings.return_value.fetchone.return_value = pool_row
    mock_db.execute.return_value = pool_result

    with (
        patch("backend.plus.pools.service._calculate_usage", return_value=fake_usage),
        patch("backend.plus.pools.service.write_audit_log", new_callable=AsyncMock),
    ):
        with pytest.raises(PermissionError) as exc_info:
            await service.check_and_lock_quota(
                mock_db, pool_id=1,
                extra_cores=2, extra_ram_mb=1024, extra_disk_gb=10, extra_vm_count=1,
                username="alice", action="deploy",
            )

    detail = json.loads(str(exc_info.value))
    assert detail["error"] == "pool_quota_exceeded"
    assert "vm_count" in detail["exceeded"]


@pytest.mark.asyncio
async def test_check_quota_unlimited_zero_passes():
    """Quota = 0 means unlimited – never fails."""
    pool_row = {
        "vm_count_quota": 0,
        "cpu_quota": 0,
        "ram_quota_mb": 0,
        "disk_quota_gb": 0,
    }
    fake_usage = {"vm_count": 9999, "cpu_used": 9999, "ram_used": 9999999, "disk_used": 9999999, "template_count": 0}

    mock_db = AsyncMock()
    pool_result = MagicMock()
    pool_result.mappings.return_value.fetchone.return_value = pool_row
    mock_db.execute.return_value = pool_result

    with patch("backend.plus.pools.service._calculate_usage", return_value=fake_usage):
        # Should not raise
        await service.check_and_lock_quota(
            mock_db, pool_id=1,
            extra_cores=1000, extra_ram_mb=100000, extra_disk_gb=100000, extra_vm_count=100,
            username="alice", action="deploy",
        )


# ── sync_orphan_members ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sync_orphan_members_removes_orphan():
    # Simulate: node_id=1 maps to proxmox_node="pve", VM 100 is gone
    node_rows = [(1, "pve")]
    member_rows = [
        {"id": 10, "pool_id": 5, "resource_type": "vm", "node_id": 1, "vmid": 100},
    ]
    live_resources = [{"type": "qemu", "node": "pve", "vmid": 200}]  # vmid 100 not here

    mock_db = AsyncMock()

    def execute_side_effect(query, params=None):
        sql = str(query)
        mock_result = MagicMock()
        if "SELECT id, proxmox_node FROM nodes" in sql:
            mock_result.fetchall.return_value = node_rows
        elif "SELECT id, pool_id, resource_type" in sql:
            mock_result.mappings.return_value.fetchall.return_value = member_rows
        else:
            mock_result.fetchall.return_value = []
        return mock_result

    mock_db.execute = AsyncMock(side_effect=execute_side_effect)
    mock_db.commit = AsyncMock()

    with (
        patch("backend.plus.pools.service.get_db") as mock_get_db,
        patch("backend.plus.pools.service.write_audit_log", new_callable=AsyncMock) as mock_audit,
    ):
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_db)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_db.return_value = ctx

        await service.sync_orphan_members(live_resources)

    # Audit log should have been called for the orphan removal
    assert mock_audit.called
    call_detail = json.loads(mock_audit.call_args[1]["detail"])
    assert call_detail["source"] == "auto_sync"
    assert call_detail["vmid"] == 100


@pytest.mark.asyncio
async def test_sync_orphan_members_no_orphans():
    node_rows = [(1, "pve")]
    member_rows = [
        {"id": 10, "pool_id": 5, "resource_type": "vm", "node_id": 1, "vmid": 100},
    ]
    # VM 100 still exists
    live_resources = [{"type": "qemu", "node": "pve", "vmid": 100}]

    mock_db = AsyncMock()

    def execute_side_effect(query, params=None):
        sql = str(query)
        mock_result = MagicMock()
        if "SELECT id, proxmox_node FROM nodes" in sql:
            mock_result.fetchall.return_value = node_rows
        elif "SELECT id, pool_id, resource_type" in sql:
            mock_result.mappings.return_value.fetchall.return_value = member_rows
        else:
            mock_result.fetchall.return_value = []
        return mock_result

    mock_db.execute = AsyncMock(side_effect=execute_side_effect)
    mock_db.commit = AsyncMock()

    with (
        patch("backend.plus.pools.service.get_db") as mock_get_db,
        patch("backend.plus.pools.service.write_audit_log", new_callable=AsyncMock) as mock_audit,
    ):
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_db)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_db.return_value = ctx

        await service.sync_orphan_members(live_resources)

    assert not mock_audit.called


# ── get_my_pools ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_my_pools_unknown_user():
    """User not found → returns empty list."""
    mock_db = AsyncMock()
    user_result = MagicMock()
    user_result.fetchone.return_value = None
    mock_db.execute.return_value = user_result

    with patch("backend.plus.pools.service.get_db") as mock_get_db:
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_db)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_db.return_value = ctx

        result = await service.get_my_pools("nobody")

    assert result == []
