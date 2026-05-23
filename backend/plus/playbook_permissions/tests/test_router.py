# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-63: pytest-Tests für den PlaybookPermissions-Router (Plus-Modul).

Testet: Auth-Guards (401/403), Happy-Path CRUD, Config GET/PUT,
        409 Duplikat, 404 unbekanntes Playbook, Me-Endpoint.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import get_db, init_db
from backend.plus.playbook_permissions.router import router
from sqlalchemy import text

pytestmark = pytest.mark.plus_only

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer_pp", auth_type="local", role="viewer")
_OPERATOR_TOKEN = create_access_token("operator_pp", auth_type="local", role="operator")
_ADMIN_TOKEN = create_access_token("admin_pp", auth_type="local", role="admin")
_MANAGE_TOKEN = create_access_token(
    "manager_pp",
    auth_type="local",
    role="operator",
    portal_permissions=["manage_playbook_permissions"],
)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest.fixture()
def with_playbook(tmp_path, monkeypatch):
    """Erstellt ein echtes vm_deploy Playbook im temp ansible_dir."""
    from backend.core.config import settings
    ansible_dir = tmp_path / "ansible"
    ansible_dir.mkdir()
    pb_dir = ansible_dir / "vm_deploy"
    pb_dir.mkdir()
    (pb_dir / "meta.yaml").write_text(
        "name: vm_deploy\ndescription: Test\nrequired_role: operator\ncategory: vm_deployment\n"
        "playbook: vm_deploy.yml\nparameters: []\n"
    )
    monkeypatch.setattr(settings, "ansible_dir", str(ansible_dir))
    return "vm_deploy"


@pytest_asyncio.fixture
async def client():
    await init_db()
    from backend.plus.playbook_permissions.models import plus_metadata
    from backend.db.database import _engine  # noqa: PLC2701
    async with _engine.begin() as conn:
        await conn.run_sync(plus_metadata.create_all)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


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


# ── Auth-Guards: Whitelist-Liste ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_permissions_unauthenticated(client):
    r = await client.get("/api/playbooks/vm_deploy/permissions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_permissions_viewer_forbidden(client):
    r = await client.get(
        "/api/playbooks/vm_deploy/permissions", headers=_auth(_VIEWER_TOKEN)
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_list_permissions_operator_forbidden(client):
    r = await client.get(
        "/api/playbooks/vm_deploy/permissions", headers=_auth(_OPERATOR_TOKEN)
    )
    assert r.status_code == 403


# ── Auth-Guards: Config ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_config_unauthenticated(client):
    r = await client.get("/api/playbook-permissions/config")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_config_viewer_forbidden(client):
    r = await client.get(
        "/api/playbook-permissions/config", headers=_auth(_VIEWER_TOKEN)
    )
    assert r.status_code == 403


# ── Config: Happy Path ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_config_admin_returns_open(client):
    r = await client.get("/api/playbook-permissions/config", headers=_auth(_ADMIN_TOKEN))
    assert r.status_code == 200
    assert r.json()["default_playbook_mode"] == "open"


@pytest.mark.asyncio
async def test_put_config_admin_sets_restricted(client):
    r = await client.put(
        "/api/playbook-permissions/config",
        json={"default_playbook_mode": "restricted"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 200
    assert r.json()["default_playbook_mode"] == "restricted"
    r2 = await client.get("/api/playbook-permissions/config", headers=_auth(_ADMIN_TOKEN))
    assert r2.json()["default_playbook_mode"] == "restricted"


@pytest.mark.asyncio
async def test_put_config_invalid_mode_422(client):
    r = await client.put(
        "/api/playbook-permissions/config",
        json={"default_playbook_mode": "banana"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_put_config_manage_permission(client):
    r = await client.put(
        "/api/playbook-permissions/config",
        json={"default_playbook_mode": "open"},
        headers=_auth(_MANAGE_TOKEN),
    )
    assert r.status_code == 200


# ── CRUD: 404 für nicht-existierendes Playbook ────────────────────────────────

@pytest.mark.asyncio
async def test_list_permissions_unknown_playbook_404(client):
    """Kein ansible_dir → jedes Playbook → 404."""
    r = await client.get(
        "/api/playbooks/ghost_playbook_nonexistent/permissions",
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_permission_unknown_playbook_404(client):
    uid = await _create_user("alice_pp")
    r = await client.post(
        "/api/playbooks/ghost_playbook_nonexistent/permissions",
        json={"subject_type": "user", "subject_id": uid},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 404


# ── CRUD: Happy Path ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_and_list_user_permission(client, with_playbook):
    uid = await _create_user("bob_pp")
    r = await client.post(
        f"/api/playbooks/{with_playbook}/permissions",
        json={"subject_type": "user", "subject_id": uid},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 201
    data = r.json()
    assert data["playbook_name"] == with_playbook
    assert data["subject_type"] == "user"
    assert data["subject_label"] == "bob_pp"

    r2 = await client.get(
        f"/api/playbooks/{with_playbook}/permissions", headers=_auth(_ADMIN_TOKEN)
    )
    assert r2.status_code == 200
    assert len(r2.json()) == 1


@pytest.mark.asyncio
async def test_add_group_permission(client, with_playbook):
    uid = await _create_user("carol_pp")
    gid = await _create_group("test-group-pp", uid)
    r = await client.post(
        f"/api/playbooks/{with_playbook}/permissions",
        json={"subject_type": "group", "subject_id": gid},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 201
    assert r.json()["subject_type"] == "group"


@pytest.mark.asyncio
async def test_add_duplicate_returns_409(client, with_playbook):
    uid = await _create_user("dave_pp")
    headers = _auth(_ADMIN_TOKEN)
    payload = {"subject_type": "user", "subject_id": uid}
    r1 = await client.post(f"/api/playbooks/{with_playbook}/permissions", json=payload, headers=headers)
    assert r1.status_code == 201
    r2 = await client.post(f"/api/playbooks/{with_playbook}/permissions", json=payload, headers=headers)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_add_unknown_subject_404(client, with_playbook):
    r = await client.post(
        f"/api/playbooks/{with_playbook}/permissions",
        json={"subject_type": "user", "subject_id": 99999},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_remove_permission(client, with_playbook):
    uid = await _create_user("eve_pp")
    r_add = await client.post(
        f"/api/playbooks/{with_playbook}/permissions",
        json={"subject_type": "user", "subject_id": uid},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r_add.status_code == 201
    perm_id = r_add.json()["id"]

    r_del = await client.delete(
        f"/api/playbooks/{with_playbook}/permissions/{perm_id}",
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r_del.status_code == 204

    r_list = await client.get(
        f"/api/playbooks/{with_playbook}/permissions", headers=_auth(_ADMIN_TOKEN)
    )
    assert r_list.json() == []


@pytest.mark.asyncio
async def test_remove_nonexistent_returns_404(client, with_playbook):
    r = await client.delete(
        f"/api/playbooks/{with_playbook}/permissions/99999",
        headers=_auth(_ADMIN_TOKEN),
    )
    assert r.status_code == 404


# ── Me-Endpoint ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_permissions_unauthenticated(client):
    r = await client.get("/api/me/playbook-permissions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_permissions_no_db_user_empty(client):
    """Token-User ohne DB-Eintrag (user_id=None) → leere Liste."""
    r = await client.get(
        "/api/me/playbook-permissions", headers=_auth(_VIEWER_TOKEN)
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_me_permissions_with_db_user(client, with_playbook):
    """Nutzer mit DB-Eintrag und direkter Whitelist → Playbook erscheint."""
    uid = await _create_user("frank_pp")
    token = create_access_token("frank_pp", auth_type="local", role="operator")

    from backend.plus.playbook_permissions import service as svc
    await svc.add_permission(with_playbook, "user", uid, uid, "frank_pp")

    r = await client.get("/api/me/playbook-permissions", headers=_auth(token))
    assert r.status_code == 200
    data = r.json()
    assert any(pb["playbook_name"] == with_playbook for pb in data)


# ── manage_playbook_permissions als delegierbare Permission ───────────────────

@pytest.mark.asyncio
async def test_manage_permission_allows_crud(client, with_playbook):
    """Operator mit manage_playbook_permissions darf Whitelist-Einträge anlegen."""
    uid = await _create_user("grace_pp")
    r = await client.post(
        f"/api/playbooks/{with_playbook}/permissions",
        json={"subject_type": "user", "subject_id": uid},
        headers=_auth(_MANAGE_TOKEN),
    )
    assert r.status_code == 201
