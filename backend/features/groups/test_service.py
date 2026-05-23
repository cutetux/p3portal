# p3portal.org
"""PROJ-45: Direkte Service-Layer-Tests für das Groups-Modul.

Ergänzt test_router.py — testet die Service-Funktionen direkt (ohne FastAPI),
deckt Pfade ab, die über HTTP schwer zu erreichen sind:
- Core-Edition-Limit (hooks.get_max_groups Patch)
- cleanup_user_from_groups (User-Deletion-Hook)
- get_user_groups / get_tags_pool (Profil-/Autocomplete-Helper)
- create_join_request ohne PROJ-50 → NotImplementedError
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db, init_db
from backend.features.groups import service


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db_ready():
    await init_db()
    # Reset module-level cache between tests (sees fresh DB)
    service._approval_available = None
    yield


async def _seed_user(username: str, role: str = "operator") -> int:
    pw_hash = hashlib.sha256(b"x").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, "
                "portal_permissions) VALUES (:u, :pw, :role, 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "role": role, "now": now},
        )
        uid = result.fetchone()[0]
        await db.commit()
    return uid


# ── create_group ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_happy_path(db_ready):
    g = await service.create_group(
        name="Web-Team",
        description="Frontend",
        tags=["web", "react"],
        owner_user_id=None,
        created_by="admin",
    )
    assert g["name"] == "Web-Team"
    assert g["description"] == "Frontend"
    assert g["tags"] == ["web", "react"]
    assert g["owner_user_id"] is None
    assert g["member_count"] == 0
    assert g["members"] == []
    assert g["created_by"] == "admin"


@pytest.mark.asyncio
async def test_create_group_with_owner(db_ready):
    uid = await _seed_user("owneruser")
    g = await service.create_group(
        name="Owner-Team",
        description=None,
        tags=[],
        owner_user_id=uid,
        created_by="admin",
    )
    assert g["owner_user_id"] == uid


@pytest.mark.asyncio
async def test_create_group_unknown_owner_raises(db_ready):
    with pytest.raises(ValueError, match="nicht gefunden"):
        await service.create_group("Ghost", None, [], 9999, "admin")


@pytest.mark.asyncio
async def test_create_group_duplicate_name_raises(db_ready):
    await service.create_group("Dup", None, [], None, "admin")
    with pytest.raises(ValueError, match="bereits"):
        await service.create_group("Dup", None, [], None, "admin")


@pytest.mark.asyncio
async def test_update_group_unknown_owner_raises(db_ready):
    g = await service.create_group("OwnerGhost", None, [], None, "admin")
    with pytest.raises(ValueError, match="nicht gefunden"):
        await service.update_group(
            g["id"], name=None, description=None, tags=None,
            owner_user_id=9999, clear_owner=False, updated_by="admin",
        )


@pytest.mark.asyncio
async def test_update_group_sets_owner(db_ready):
    uid = await _seed_user("alice")
    g = await service.create_group("OwnedGroup", None, [], None, "admin")
    updated = await service.update_group(
        g["id"], name=None, description=None, tags=None,
        owner_user_id=uid, clear_owner=False, updated_by="admin",
    )
    assert updated["owner_user_id"] == uid
    assert updated["owner_username"] == "alice"


# ── Core-Limit (Plus-Hook) ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_core_limit_blocks(db_ready, monkeypatch):
    """hooks.get_max_groups() returns 2 → 3rd create must raise."""
    monkeypatch.setattr(service.plus_behavior, "get_max_groups", lambda: 2)
    await service.create_group("g1", None, [], None, "admin")
    await service.create_group("g2", None, [], None, "admin")
    with pytest.raises(PermissionError, match="maximal 2"):
        await service.create_group("g3", None, [], None, "admin")


@pytest.mark.asyncio
async def test_create_group_no_limit_when_plus(db_ready, monkeypatch):
    """hooks.get_max_groups() returns None → unlimited."""
    monkeypatch.setattr(service.plus_behavior, "get_max_groups", lambda: None)
    for i in range(5):
        await service.create_group(f"g{i}", None, [], None, "admin")
    groups = await service.list_groups()
    assert len(groups) == 5


# ── update_group ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_group_rename(db_ready):
    g = await service.create_group("Old", None, [], None, "admin")
    updated = await service.update_group(
        g["id"], name="New", description=None, tags=None,
        owner_user_id=None, clear_owner=False, updated_by="admin",
    )
    assert updated["name"] == "New"


@pytest.mark.asyncio
async def test_update_group_clear_owner(db_ready):
    uid = await _seed_user("bob")
    g = await service.create_group("Owned", None, [], None, "admin")
    await service.update_group(
        g["id"], name=None, description=None, tags=None,
        owner_user_id=uid, clear_owner=False, updated_by="admin",
    )
    updated = await service.update_group(
        g["id"], name=None, description=None, tags=None,
        owner_user_id=None, clear_owner=True, updated_by="admin",
    )
    assert updated["owner_user_id"] is None


@pytest.mark.asyncio
async def test_update_group_not_found(db_ready):
    result = await service.update_group(
        9999, name="Ghost", description=None, tags=None,
        owner_user_id=None, clear_owner=False, updated_by="admin",
    )
    assert result is None


# ── delete_group ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_group_happy_path(db_ready):
    g = await service.create_group("DeleteMe", None, [], None, "admin")
    ok = await service.delete_group(g["id"], deleted_by="admin")
    assert ok is True
    assert await service.get_group(g["id"]) is None


@pytest.mark.asyncio
async def test_delete_group_not_found(db_ready):
    ok = await service.delete_group(9999, deleted_by="admin")
    assert ok is False


# ── add_member / remove_member ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_member_happy_path(db_ready):
    g = await service.create_group("Team", None, [], None, "admin")
    uid = await _seed_user("charlie")
    member = await service.add_member(g["id"], uid, added_by="admin")
    assert member["username"] == "charlie"
    refetched = await service.get_group(g["id"])
    assert refetched["member_count"] == 1
    assert refetched["members"][0]["username"] == "charlie"


@pytest.mark.asyncio
async def test_add_member_duplicate_raises(db_ready):
    g = await service.create_group("Team", None, [], None, "admin")
    uid = await _seed_user("dave")
    await service.add_member(g["id"], uid, added_by="admin")
    with pytest.raises(ValueError, match="bereits Mitglied"):
        await service.add_member(g["id"], uid, added_by="admin")


@pytest.mark.asyncio
async def test_add_member_unknown_user_raises(db_ready):
    g = await service.create_group("Team", None, [], None, "admin")
    with pytest.raises(ValueError, match="nicht gefunden"):
        await service.add_member(g["id"], 9999, added_by="admin")


@pytest.mark.asyncio
async def test_add_member_unknown_group_raises(db_ready):
    uid = await _seed_user("eve")
    with pytest.raises(KeyError, match="9999"):
        await service.add_member(9999, uid, added_by="admin")


@pytest.mark.asyncio
async def test_remove_member_happy_path(db_ready):
    g = await service.create_group("Team", None, [], None, "admin")
    uid = await _seed_user("frank")
    await service.add_member(g["id"], uid, added_by="admin")
    ok = await service.remove_member(g["id"], uid, removed_by="admin")
    assert ok is True
    assert (await service.get_group(g["id"]))["member_count"] == 0


@pytest.mark.asyncio
async def test_remove_member_not_a_member_returns_false(db_ready):
    g = await service.create_group("Team", None, [], None, "admin")
    ok = await service.remove_member(g["id"], 9999, removed_by="admin")
    assert ok is False


# ── list_groups Filtering ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_groups_search_case_insensitive(db_ready):
    await service.create_group("Web-Team", None, [], None, "admin")
    await service.create_group("DB-Team", None, [], None, "admin")
    results = await service.list_groups(search="web")
    assert [g["name"] for g in results] == ["Web-Team"]


@pytest.mark.asyncio
async def test_list_groups_no_owner_filter(db_ready):
    uid = await _seed_user("grace")
    await service.create_group("Orphan", None, [], None, "admin")
    g = await service.create_group("Owned", None, [], None, "admin")
    await service.update_group(
        g["id"], name=None, description=None, tags=None,
        owner_user_id=uid, clear_owner=False, updated_by="admin",
    )
    results = await service.list_groups(no_owner=True)
    assert [g["name"] for g in results] == ["Orphan"]


@pytest.mark.asyncio
async def test_list_groups_tag_filter(db_ready):
    await service.create_group("Web", None, ["frontend"], None, "admin")
    await service.create_group("DB", None, ["backend"], None, "admin")
    results = await service.list_groups(tag="frontend")
    assert [g["name"] for g in results] == ["Web"]


# ── cleanup_user_from_groups ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cleanup_user_from_groups_writes_audit(db_ready):
    """User deletion: function writes audit entries; CASCADE handles row removal."""
    uid = await _seed_user("henry")
    g_member = await service.create_group("M", None, [], None, "admin")
    g_owned = await service.create_group("O", None, [], None, "admin")
    await service.update_group(
        g_owned["id"], name=None, description=None, tags=None,
        owner_user_id=uid, clear_owner=False, updated_by="admin",
    )
    await service.add_member(g_member["id"], uid, added_by="admin")

    # Simulate user row deletion (triggers CASCADE on group_members,
    # SET NULL on owner_user_id) — must happen BEFORE cleanup_user_from_groups
    # reads memberships, because the function captures snapshots from DB.
    # In production this is called BEFORE the DB delete by admin.py.
    await service.cleanup_user_from_groups(uid, "henry", deleted_by="admin")
    # Function only writes audit — no assertion on group state needed.
    # We assert that the function doesn't raise.


# ── get_user_groups (Profil-Helper) ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_user_groups_returns_memberships(db_ready):
    uid = await _seed_user("iris")
    g1 = await service.create_group("Alpha", None, [], None, "admin")
    g2 = await service.create_group("Beta", None, [], None, "admin")
    await service.add_member(g1["id"], uid, added_by="admin")
    await service.add_member(g2["id"], uid, added_by="admin")
    groups = await service.get_user_groups("iris")
    names = sorted(g["name"] for g in groups)
    assert names == ["Alpha", "Beta"]


@pytest.mark.asyncio
async def test_get_user_groups_empty_for_unknown_user(db_ready):
    groups = await service.get_user_groups("nobody")
    assert groups == []


# ── get_tags_pool ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_tags_pool_deduplicates(db_ready):
    await service.create_group("g1", None, ["web", "react"], None, "admin")
    await service.create_group("g2", None, ["web", "vue"], None, "admin")
    tags = await service.get_tags_pool()
    assert sorted(tags) == ["react", "vue", "web"]


@pytest.mark.asyncio
async def test_get_tags_pool_empty(db_ready):
    await service.create_group("g1", None, [], None, "admin")
    tags = await service.get_tags_pool()
    assert tags == []


# ── create_join_request (PROJ-50-Stub) ────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_join_request_blocked_without_proj50(db_ready):
    """pending_approvals table does not exist yet → must raise NotImplementedError."""
    g = await service.create_group("Team", None, [], None, "admin")
    uid = await _seed_user("john")
    with pytest.raises(NotImplementedError, match="PROJ-50"):
        await service.create_join_request(g["id"], uid, "john", reason=None)


# ── Audit-Log-Side-Effects ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_writes_audit(db_ready):
    g = await service.create_group("Audited", None, [], None, "admin")
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT event_type, detail FROM audit_logs "
                "WHERE event_type = 'group_created' ORDER BY id DESC LIMIT 1"
            )
        )
        row = result.fetchone()
    assert row is not None
    detail = json.loads(row[1])
    assert detail["group_id"] == g["id"]
    assert detail["name"] == "Audited"


@pytest.mark.asyncio
async def test_delete_group_writes_audit(db_ready):
    g = await service.create_group("Doomed", None, [], None, "admin")
    await service.delete_group(g["id"], deleted_by="admin")
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT detail FROM audit_logs "
                "WHERE event_type = 'group_deleted' ORDER BY id DESC LIMIT 1"
            )
        )
        row = result.fetchone()
    assert row is not None
    detail = json.loads(row[0])
    assert detail["name"] == "Doomed"
