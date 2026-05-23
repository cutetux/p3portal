# p3portal.org
"""PROJ-57: Service-Layer-Tests für das Help-Override-System.

Testet:
- upload_user_override: Happy-Path, Update, Core-Limit, Proxmox-User
- list_user_overrides / list_global_overrides
- delete_override: Owner, Admin, fremder User
- promote_to_global: Happy-Path, Nicht-User-Scope, Re-Promote
- remove_global_override: Happy-Path, Nicht-vorhanden
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
import pytest
import pytest_asyncio
from sqlalchemy import text

from backend.core.config import settings
from backend.core.plus_protocol import plus_behavior
from backend.db.database import get_db, init_db
from backend.features.help import service


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db_ready():
    await init_db()
    yield


async def _seed_user(username: str, role: str = "operator") -> int:
    pw_hash = hashlib.sha256(b"test").hexdigest()
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


SAMPLE_CONTENT = "# Dashboard\n\nDas Dashboard zeigt den Cluster-Überblick.\n"


# ── upload_user_override ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_creates_new_override(db_ready):
    uid = await _seed_user("alice")
    record = await service.upload_user_override(
        user_id=uid,
        username="alice",
        key="dashboard",
        lang="de",
        content=SAMPLE_CONTENT,
    )
    assert record["key"] == "dashboard"
    assert record["lang"] == "de"
    assert record["scope"] == "user"
    assert record["owner_user_id"] == uid
    assert SAMPLE_CONTENT in record["content"]
    assert len(record["content_md5"]) == 32


@pytest.mark.asyncio
async def test_upload_updates_existing_override(db_ready):
    uid = await _seed_user("bob")
    await service.upload_user_override(
        user_id=uid, username="bob", key="dashboard", lang="de", content="Version 1"
    )
    updated = await service.upload_user_override(
        user_id=uid, username="bob", key="dashboard", lang="de", content="Version 2"
    )
    assert updated["content"] == "Version 2"

    # Nur ein Eintrag in der DB
    overrides = await service.list_user_overrides(uid)
    assert len(overrides) == 1


@pytest.mark.asyncio
async def test_upload_respects_core_limit(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_help_overrides_per_user", lambda: 2)
    uid = await _seed_user("charlie")
    await service.upload_user_override(
        user_id=uid, username="charlie", key="k1", lang="de", content="C1"
    )
    await service.upload_user_override(
        user_id=uid, username="charlie", key="k2", lang="de", content="C2"
    )
    with pytest.raises(PermissionError, match="Max"):
        await service.upload_user_override(
            user_id=uid, username="charlie", key="k3", lang="de", content="C3"
        )


@pytest.mark.asyncio
async def test_upload_same_key_different_lang_separate(db_ready):
    uid = await _seed_user("dave")
    await service.upload_user_override(
        user_id=uid, username="dave", key="dashboard", lang="de", content="DE-Version"
    )
    await service.upload_user_override(
        user_id=uid, username="dave", key="dashboard", lang="en", content="EN-Version"
    )
    overrides = await service.list_user_overrides(uid)
    assert len(overrides) == 2


# ── list_user_overrides / list_global_overrides ────────────────────────────────

@pytest.mark.asyncio
async def test_list_user_overrides_empty(db_ready):
    uid = await _seed_user("eve")
    result = await service.list_user_overrides(uid)
    assert result == []


@pytest.mark.asyncio
async def test_list_global_overrides_empty(db_ready):
    result = await service.list_global_overrides()
    assert result == []


@pytest.mark.asyncio
async def test_list_user_overrides_isolation(db_ready):
    uid1 = await _seed_user("frank")
    uid2 = await _seed_user("grace")
    await service.upload_user_override(
        user_id=uid1, username="frank", key="dashboard", lang="de", content="Frank"
    )
    result = await service.list_user_overrides(uid2)
    assert result == []


# ── delete_override ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_owner_can_delete_own_override(db_ready):
    uid = await _seed_user("henry")
    record = await service.upload_user_override(
        user_id=uid, username="henry", key="dashboard", lang="de", content="Test"
    )
    await service.delete_override(
        override_id=record["id"],
        current_user_id=uid,
        current_username="henry",
        is_admin=False,
    )
    overrides = await service.list_user_overrides(uid)
    assert overrides == []


@pytest.mark.asyncio
async def test_other_user_cannot_delete_override(db_ready):
    uid1 = await _seed_user("ivan")
    uid2 = await _seed_user("judy")
    record = await service.upload_user_override(
        user_id=uid1, username="ivan", key="dashboard", lang="de", content="Test"
    )
    with pytest.raises(PermissionError):
        await service.delete_override(
            override_id=record["id"],
            current_user_id=uid2,
            current_username="judy",
            is_admin=False,
        )


@pytest.mark.asyncio
async def test_admin_can_delete_foreign_override(db_ready):
    uid = await _seed_user("kira")
    record = await service.upload_user_override(
        user_id=uid, username="kira", key="dashboard", lang="de", content="Test"
    )
    await service.delete_override(
        override_id=record["id"],
        current_user_id=999,
        current_username="admin",
        is_admin=True,
    )
    overrides = await service.list_user_overrides(uid)
    assert overrides == []


@pytest.mark.asyncio
async def test_delete_nonexistent_raises(db_ready):
    with pytest.raises(LookupError):
        await service.delete_override(
            override_id=99999,
            current_user_id=1,
            current_username="admin",
            is_admin=True,
        )


# ── promote_to_global ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_promote_user_override_to_global(db_ready):
    uid = await _seed_user("liam")
    record = await service.upload_user_override(
        user_id=uid, username="liam", key="dashboard", lang="de", content="Promoted Content"
    )
    global_record = await service.promote_to_global(
        override_id=record["id"],
        admin_user_id=uid,
        admin_username="admin",
    )
    assert global_record["scope"] == "global"
    assert global_record["key"] == "dashboard"
    assert global_record["lang"] == "de"
    assert global_record["content"] == "Promoted Content"
    assert global_record["owner_user_id"] is None
    assert global_record["original_uploader_user_id"] == uid


@pytest.mark.asyncio
async def test_promote_nonexistent_raises(db_ready):
    with pytest.raises(LookupError):
        await service.promote_to_global(
            override_id=99999, admin_user_id=1, admin_username="admin"
        )


@pytest.mark.asyncio
async def test_promote_global_override_raises(db_ready):
    uid = await _seed_user("mia")
    user_record = await service.upload_user_override(
        user_id=uid, username="mia", key="packer", lang="en", content="EN Content"
    )
    global_record = await service.promote_to_global(
        override_id=user_record["id"], admin_user_id=uid, admin_username="admin"
    )
    # Versuche den globalen Override zu promoten → Fehler
    with pytest.raises(ValueError, match="Nur User-Overrides"):
        await service.promote_to_global(
            override_id=global_record["id"], admin_user_id=uid, admin_username="admin"
        )


@pytest.mark.asyncio
async def test_promote_replaces_existing_global(db_ready):
    uid = await _seed_user("noah")
    r1 = await service.upload_user_override(
        user_id=uid, username="noah", key="jobs", lang="de", content="Version 1"
    )
    await service.promote_to_global(
        override_id=r1["id"], admin_user_id=uid, admin_username="admin"
    )
    r2 = await service.upload_user_override(
        user_id=uid, username="noah", key="jobs", lang="de", content="Version 2"
    )
    await service.promote_to_global(
        override_id=r2["id"], admin_user_id=uid, admin_username="admin"
    )
    globals_list = await service.list_global_overrides()
    jobs_de = [g for g in globals_list if g["key"] == "jobs" and g["lang"] == "de"]
    assert len(jobs_de) == 1
    assert jobs_de[0]["content"] == "Version 2"


# ── remove_global_override ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_remove_global_override(db_ready):
    uid = await _seed_user("olivia")
    record = await service.upload_user_override(
        user_id=uid, username="olivia", key="logs", lang="en", content="EN Logs Help"
    )
    await service.promote_to_global(
        override_id=record["id"], admin_user_id=uid, admin_username="admin"
    )
    await service.remove_global_override(
        key="logs", lang="en", admin_username="admin"
    )
    globals_list = await service.list_global_overrides()
    assert all(g["key"] != "logs" for g in globals_list)


@pytest.mark.asyncio
async def test_remove_nonexistent_global_raises(db_ready):
    with pytest.raises(LookupError):
        await service.remove_global_override(
            key="nonexistent_key", lang="de", admin_username="admin"
        )


# ── list_all_overrides_admin ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_list_includes_user_and_global(db_ready):
    uid = await _seed_user("paul")
    user_record = await service.upload_user_override(
        user_id=uid, username="paul", key="packer", lang="de", content="Packer DE"
    )
    await service.promote_to_global(
        override_id=user_record["id"], admin_user_id=uid, admin_username="admin"
    )

    all_overrides = await service.list_all_overrides_admin()
    scopes = {o["scope"] for o in all_overrides}
    assert "user" in scopes
    assert "global" in scopes
