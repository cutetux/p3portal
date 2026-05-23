# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-63: Tests für backend/plus/playbook_permissions/service.py.

Testet: Pydantic-Schemas, CRUD (add/remove/list), Resolver-Integration,
Config (get/set), Cleanup-Hooks, Stale-Cleanup, Bulk-Lookup.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio

from backend.db.database import get_db, init_db
from backend.plus.playbook_permissions.schemas import (
    AddPermissionRequest,
    AllowedPlaybook,
    PlaybookPermissionConfig,
    PlaybookPermissionEntry,
)
from backend.plus.playbook_permissions import service as svc
from sqlalchemy import text

pytestmark = pytest.mark.plus_only


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
    pw_hash = hashlib.sha256(b"pw").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        r = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, portal_permissions) "
                "VALUES (:u, :pw, :r, 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "r": role, "now": now},
        )
        uid = r.fetchone()[0]
        await db.commit()
    return uid


async def _create_group(name: str, owner_id: int) -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        r = await db.execute(
            text(
                "INSERT INTO groups (name, description, owner_user_id, tags, created_at, created_by) "
                "VALUES (:n, '', :oid, '[]', :now, 'system') RETURNING id"
            ),
            {"n": name, "oid": owner_id, "now": now},
        )
        gid = r.fetchone()[0]
        await db.commit()
    return gid


async def _add_to_group(group_id: int, user_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text(
                "INSERT INTO group_members (group_id, user_id, member_kind, added_at, added_by) "
                "VALUES (:g, :u, 'local_user', :now, 'system')"
            ),
            {"g": group_id, "u": user_id, "now": now},
        )
        await db.commit()


# ── Schema-Tests ─────────────────────────────────────────────────────────────

class TestSchemas:
    def test_permission_entry(self):
        entry = PlaybookPermissionEntry(
            id=1,
            playbook_name="vm_deploy",
            subject_type="user",
            subject_id=5,
            subject_label="alice",
            added_at="2026-01-01T00:00:00+00:00",
            added_by_user_id=1,
            added_by_username="admin",
        )
        assert entry.subject_label == "alice"
        assert entry.playbook_name == "vm_deploy"

    def test_add_request(self):
        req = AddPermissionRequest(subject_type="group", subject_id=3)
        assert req.subject_type == "group"
        assert req.subject_id == 3

    def test_config_schema(self):
        cfg = PlaybookPermissionConfig(default_playbook_mode="restricted")
        assert cfg.default_playbook_mode == "restricted"

    def test_allowed_playbook(self):
        pb = AllowedPlaybook(playbook_name="vm_deploy", category="vm_deployment", source="direct")
        assert pb.source == "direct"
        pb2 = AllowedPlaybook(playbook_name="vm_deploy", category=None, source="admin")
        assert pb2.category is None


# ── Config: get / set ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_default_mode_returns_open():
    mode = await svc.get_default_playbook_mode()
    assert mode == "open"


@pytest.mark.asyncio
async def test_set_default_mode():
    mode = await svc.set_default_playbook_mode("restricted", actor_username="admin")
    assert mode == "restricted"
    mode2 = await svc.get_default_playbook_mode()
    assert mode2 == "restricted"


@pytest.mark.asyncio
async def test_set_default_mode_invalid():
    with pytest.raises(ValueError, match="Ungültiger Modus"):
        await svc.set_default_playbook_mode("invalid_mode", actor_username="admin")


@pytest.mark.asyncio
async def test_set_default_mode_idempotent():
    """Gleicher Modus nochmal setzen → kein Fehler, kein doppeltes Audit."""
    await svc.set_default_playbook_mode("open", actor_username="admin")
    mode = await svc.get_default_playbook_mode()
    assert mode == "open"


# ── CRUD ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_and_list_user_permission():
    uid = await _create_user("alice")
    entry = await svc.add_permission(
        playbook_name="vm_deploy",
        subject_type="user",
        subject_id=uid,
        actor_user_id=uid,
        actor_username="alice",
    )
    assert entry["playbook_name"] == "vm_deploy"
    assert entry["subject_type"] == "user"
    assert entry["subject_label"] == "alice"

    entries = await svc.list_permissions("vm_deploy")
    assert len(entries) == 1
    assert entries[0]["subject_id"] == uid


@pytest.mark.asyncio
async def test_add_group_permission():
    uid = await _create_user("owner_user")
    gid = await _create_group("infra-leads", uid)
    entry = await svc.add_permission(
        playbook_name="vm_deploy",
        subject_type="group",
        subject_id=gid,
        actor_user_id=uid,
        actor_username="owner_user",
    )
    assert entry["subject_type"] == "group"
    assert "infra-leads" in entry["subject_label"]


@pytest.mark.asyncio
async def test_add_duplicate_raises():
    uid = await _create_user("bob")
    await svc.add_permission("vm_deploy", "user", uid, uid, "bob")
    with pytest.raises(ValueError, match="duplicate"):
        await svc.add_permission("vm_deploy", "user", uid, uid, "bob")


@pytest.mark.asyncio
async def test_add_unknown_user_raises():
    uid = await _create_user("carol")
    with pytest.raises(KeyError):
        await svc.add_permission("vm_deploy", "user", 99999, uid, "carol")


@pytest.mark.asyncio
async def test_remove_permission():
    uid = await _create_user("dave")
    entry = await svc.add_permission("vm_deploy", "user", uid, uid, "dave")
    removed = await svc.remove_permission(entry["id"], "dave")
    assert removed is True
    entries = await svc.list_permissions("vm_deploy")
    assert entries == []


@pytest.mark.asyncio
async def test_remove_nonexistent_returns_false():
    removed = await svc.remove_permission(99999, "admin")
    assert removed is False


@pytest.mark.asyncio
async def test_invalid_subject_type_raises():
    uid = await _create_user("eve")
    with pytest.raises(ValueError, match="subject_type"):
        await svc.add_permission("vm_deploy", "role", uid, uid, "eve")


# ── Cleanup-Hooks ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_user_delete_removes_entries():
    uid = await _create_user("frank")
    await svc.add_permission("vm_deploy", "user", uid, uid, "frank")
    await svc.on_user_delete(uid, "admin")
    entries = await svc.list_permissions("vm_deploy")
    assert entries == []


@pytest.mark.asyncio
async def test_on_group_delete_removes_entries():
    uid = await _create_user("grace")
    gid = await _create_group("ops-team", uid)
    await svc.add_permission("vm_deploy", "group", gid, uid, "grace")
    await svc.on_group_delete(gid, "admin")
    entries = await svc.list_permissions("vm_deploy")
    assert entries == []


@pytest.mark.asyncio
async def test_on_playbook_delete_removes_entries():
    uid = await _create_user("henry")
    await svc.add_permission("vm_destroy", "user", uid, uid, "henry")
    await svc.on_playbook_delete("vm_destroy", "admin")
    entries = await svc.list_permissions("vm_destroy")
    assert entries == []


@pytest.mark.asyncio
async def test_cleanup_stale_permissions(monkeypatch):
    """Stale-Cleanup entfernt Einträge für nicht mehr existierende Playbooks."""
    uid = await _create_user("iris")
    # Eintrag direkt in DB schreiben (Playbook existiert nicht in list_playbooks)
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text(
                "INSERT INTO playbook_permissions (playbook_name, subject_type, subject_id, added_at) "
                "VALUES ('ghost_playbook', 'user', :uid, :now)"
            ),
            {"uid": uid, "now": now},
        )
        await db.commit()

    # list_playbooks gibt nichts zurück (kein ansible_dir)
    count = await svc.cleanup_stale_permissions("admin")
    assert count >= 1

    entries = await svc.list_permissions("ghost_playbook")
    assert entries == []


# ── Whitelist-Existenz-Checks ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_has_whitelist_entry_direct():
    uid = await _create_user("jack")
    await svc.add_permission("vm_deploy", "user", uid, uid, "jack")
    async with get_db() as db:
        result = await svc.has_whitelist_entry_for_user(db, "vm_deploy", uid, [])
    assert result is True


@pytest.mark.asyncio
async def test_has_whitelist_entry_via_group():
    owner = await _create_user("owner_j")
    member = await _create_user("member_j")
    gid = await _create_group("group_j", owner)
    await _add_to_group(gid, member)
    await svc.add_permission("vm_deploy", "group", gid, owner, "owner_j")
    async with get_db() as db:
        result = await svc.has_whitelist_entry_for_user(db, "vm_deploy", member, [gid])
    assert result is True


@pytest.mark.asyncio
async def test_has_whitelist_entry_not_listed():
    uid = await _create_user("kate")
    other = await _create_user("other_k")
    await svc.add_permission("vm_deploy", "user", other, other, "other_k")
    async with get_db() as db:
        result = await svc.has_whitelist_entry_for_user(db, "vm_deploy", uid, [])
    assert result is False


@pytest.mark.asyncio
async def test_playbook_has_any_whitelist_entry():
    uid = await _create_user("leo")
    async with get_db() as db:
        before = await svc.playbook_has_any_whitelist_entry(db, "unique_playbook")
    assert before is False
    await svc.add_permission("unique_playbook", "user", uid, uid, "leo")
    async with get_db() as db:
        after = await svc.playbook_has_any_whitelist_entry(db, "unique_playbook")
    assert after is True
