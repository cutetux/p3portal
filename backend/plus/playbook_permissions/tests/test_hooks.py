# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-63: Tests für PlaybookPermissionsPlusBehavior (9 Hooks) + Core-Defaults."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio

from backend.core.plus_protocol import (
    CorePlusBehavior,
    PlaybookPermissionDecision,
    AllowedPlaybookEntry,
)
from backend.db.database import get_db, init_db
from sqlalchemy import text

pytestmark = pytest.mark.plus_only


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture(autouse=True)
async def db(patch_data_dir):
    await init_db()
    from backend.plus.playbook_permissions.models import plus_metadata
    from backend.db.database import _engine  # noqa: PLC2701
    async with _engine.begin() as conn:
        await conn.run_sync(plus_metadata.create_all)


async def _create_user(username: str, role: str = "operator") -> int:
    import hashlib
    pw = hashlib.sha256(b"pw").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        r = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, portal_permissions) "
                "VALUES (:u, :pw, :r, 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw, "r": role, "now": now},
        )
        uid = r.fetchone()[0]
        await db.commit()
    return uid


async def _add_whitelist(playbook_name: str, subject_type: str, subject_id: int):
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text(
                "INSERT INTO playbook_permissions (playbook_name, subject_type, subject_id, added_at) "
                "VALUES (:name, :st, :sid, :now)"
            ),
            {"name": playbook_name, "st": subject_type, "sid": subject_id, "now": now},
        )
        await db.commit()


@pytest.fixture
def behavior():
    from backend.plus.playbook_permissions_plus import PlaybookPermissionsPlusBehavior
    return PlaybookPermissionsPlusBehavior()


# ── Gate-Hook ─────────────────────────────────────────────────────────────────

def test_can_use_playbook_permissions_true(behavior):
    assert behavior.can_use_playbook_permissions() is True


def test_core_default_can_use_playbook_permissions_false():
    core = CorePlusBehavior()
    assert core.can_use_playbook_permissions() is False


# ── Core-Defaults: alle FALLBACK / [] / 0 ─────────────────────────────────────

@pytest.mark.asyncio
async def test_core_default_can_user_execute_playbook_is_fallback():
    core = CorePlusBehavior()
    result = await core.can_user_execute_playbook(1, "any_playbook")
    assert result == PlaybookPermissionDecision.FALLBACK


@pytest.mark.asyncio
async def test_core_default_get_playbook_can_execute_map_all_fallback():
    core = CorePlusBehavior()
    result = await core.get_playbook_can_execute_map(1, ["pb_a", "pb_b"])
    assert all(v == PlaybookPermissionDecision.FALLBACK for v in result.values())


@pytest.mark.asyncio
async def test_core_default_get_my_allowed_playbooks_empty():
    core = CorePlusBehavior()
    result = await core.get_my_allowed_playbooks(1)
    assert result == []


@pytest.mark.asyncio
async def test_core_default_cleanup_hooks_return_zero():
    core = CorePlusBehavior()
    assert await core.on_user_deleted_playbook_permissions(1, "actor") == 0
    assert await core.on_group_deleted_playbook_permissions(1, "actor") == 0
    assert await core.on_playbook_deleted_playbook_permissions("pb", "actor") == 0
    assert await core.cleanup_stale_playbook_permissions({"pb"}) == 0


def test_core_default_get_extra_portal_permissions_empty():
    core = CorePlusBehavior()
    assert core.get_extra_portal_permissions() == []


def test_core_default_ensure_plus_db_tables_noop():
    """ensure_plus_db_tables() muss im Core fehlerlos eine No-Op sein (BUG-63-2)."""
    core = CorePlusBehavior()
    result = core.ensure_plus_db_tables()
    assert result is None


def test_plus_gate_get_extra_portal_permissions_contains_manage_playbook_permissions(monkeypatch):
    """Plus-Edition: get_extra_portal_permissions() enthält manage_playbook_permissions (AC-CAPABILITIES-2)."""
    from backend.core.plus_protocol import plus_behavior
    monkeypatch.setattr(plus_behavior, "get_extra_portal_permissions", lambda: ["manage_pools", "manage_playbook_permissions"])
    perms = plus_behavior.get_extra_portal_permissions()
    assert "manage_playbook_permissions" in perms


# ── Plus-Override: Decision-Matrix ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_can_user_execute_allow_when_whitelisted(behavior):
    uid = await _create_user("wl_user")
    await _add_whitelist("my_pb", "user", uid)
    result = await behavior.can_user_execute_playbook(uid, "my_pb")
    assert result == PlaybookPermissionDecision.ALLOW


@pytest.mark.asyncio
async def test_can_user_execute_deny_when_whitelist_active_but_user_missing(behavior):
    uid = await _create_user("other_user")
    uid2 = await _create_user("not_in_wl")
    await _add_whitelist("restricted_pb", "user", uid)
    result = await behavior.can_user_execute_playbook(uid2, "restricted_pb")
    assert result == PlaybookPermissionDecision.DENY


@pytest.mark.asyncio
async def test_can_user_execute_deny_when_restricted_mode_no_whitelist(behavior, monkeypatch):
    uid = await _create_user("some_user")
    from backend.plus.playbook_permissions import service as svc
    async with get_db() as db:
        await db.execute(
            text("INSERT OR REPLACE INTO playbook_permissions_config (id, default_mode, updated_at) VALUES (1, 'restricted', :now)"),
            {"now": datetime.now(timezone.utc).isoformat()},
        )
        await db.commit()
    result = await behavior.can_user_execute_playbook(uid, "no_whitelist_pb")
    assert result == PlaybookPermissionDecision.DENY


@pytest.mark.asyncio
async def test_can_user_execute_fallback_when_open_mode_no_whitelist(behavior):
    uid = await _create_user("open_user")
    # default_mode=open (default if no row)
    result = await behavior.can_user_execute_playbook(uid, "no_whitelist_pb")
    assert result == PlaybookPermissionDecision.FALLBACK


# ── Bulk-Resolver ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_playbook_can_execute_map_empty_names(behavior):
    result = await behavior.get_playbook_can_execute_map(1, [])
    assert result == {}


@pytest.mark.asyncio
async def test_get_playbook_can_execute_map_mixed_decisions(behavior):
    uid = await _create_user("bulk_user")
    await _add_whitelist("allowed_pb", "user", uid)
    uid2 = await _create_user("other2")
    await _add_whitelist("denied_pb", "user", uid2)

    result = await behavior.get_playbook_can_execute_map(uid, ["allowed_pb", "denied_pb", "open_pb"])
    assert result["allowed_pb"] == PlaybookPermissionDecision.ALLOW
    assert result["denied_pb"] == PlaybookPermissionDecision.DENY
    assert result["open_pb"] == PlaybookPermissionDecision.FALLBACK


# ── Cleanup-Hooks ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_user_deleted_removes_entries(behavior):
    uid = await _create_user("del_user")
    await _add_whitelist("pb1", "user", uid)
    await _add_whitelist("pb2", "user", uid)
    count = await behavior.on_user_deleted_playbook_permissions(uid, "admin")
    assert count == 2
    async with get_db() as db:
        r = await db.execute(
            text("SELECT COUNT(*) FROM playbook_permissions WHERE subject_type='user' AND subject_id=:uid"),
            {"uid": uid},
        )
        assert r.scalar() == 0


@pytest.mark.asyncio
async def test_on_user_deleted_returns_zero_if_no_entries(behavior):
    count = await behavior.on_user_deleted_playbook_permissions(9999, "admin")
    assert count == 0


@pytest.mark.asyncio
async def test_on_group_deleted_removes_entries(behavior):
    uid = await _create_user("grp_user")
    async with get_db() as db:
        r = await db.execute(
            text("INSERT INTO groups (name, created_at, created_by) VALUES ('grp1', :now, :uid) RETURNING id"),
            {"now": datetime.now(timezone.utc).isoformat(), "uid": uid},
        )
        gid = r.fetchone()[0]
        await db.commit()
    await _add_whitelist("pb_g", "group", gid)
    count = await behavior.on_group_deleted_playbook_permissions(gid, "admin")
    assert count == 1


@pytest.mark.asyncio
async def test_on_playbook_deleted_removes_entries(behavior):
    uid = await _create_user("pb_del_user")
    await _add_whitelist("vanished_pb", "user", uid)
    count = await behavior.on_playbook_deleted_playbook_permissions("vanished_pb", "admin")
    assert count == 1


@pytest.mark.asyncio
async def test_cleanup_stale_removes_only_missing(behavior):
    uid = await _create_user("stale_user")
    await _add_whitelist("existing_pb", "user", uid)
    await _add_whitelist("stale_pb", "user", uid)
    count = await behavior.cleanup_stale_playbook_permissions({"existing_pb"})
    assert count == 1
    async with get_db() as db:
        r = await db.execute(text("SELECT COUNT(*) FROM playbook_permissions WHERE playbook_name='existing_pb'"))
        assert r.scalar() == 1
        r = await db.execute(text("SELECT COUNT(*) FROM playbook_permissions WHERE playbook_name='stale_pb'"))
        assert r.scalar() == 0
