# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-46: pytest-Tests für den Pools-Router.

Testet: Happy-Path (CRUD), 403-Pfade, 409-Konflikte, 422-Validierung,
Quota-Gate (Core/Plus), Member-Add/Remove, Assignment-Lifecycle,
Usage-Endpoint, delete-preview, VM-Pool-Move.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db, get_db
from backend.plus.pools.router import router, me_router, vms_router
from backend.core.plus_protocol import plus_behavior
from sqlalchemy import text

pytestmark = pytest.mark.plus_only

app = FastAPI()
app.include_router(router)
app.include_router(me_router)
app.include_router(vms_router)

_OPERATOR_TOKEN = create_access_token("operator", role="operator", auth_type="local")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_MANAGE_TOKEN = create_access_token(
    "manager",
    auth_type="local",
    role="operator",
    portal_permissions=["manage_pools"],
)


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    # PROJ-62: Pool-Tabellen via plus_metadata erzeugen (in Core-Tests nicht vorhanden)
    from backend.plus.pools.models import plus_metadata
    from backend.db.database import _engine  # noqa: PLC2701
    async with _engine.begin() as conn:
        await conn.run_sync(plus_metadata.create_all)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── DB seed helpers ───────────────────────────────────────────────────────────

async def _create_user(username: str, role: str = "operator", permissions: list | None = None) -> int:
    pw_hash = hashlib.sha256(b"pw123").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, portal_permissions) "
                "VALUES (:u, :pw, :role, 1, :now, :perms) RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "role": role, "now": now,
             "perms": json.dumps(permissions or [])},
        )
        uid = result.fetchone()[0]
        await db.commit()
    return uid


async def _create_preset(name: str = "TestPreset") -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO role_presets (name, description, permissions, created_at, created_by) "
                "VALUES (:n, '', '[]', :now, 'admin') RETURNING id"
            ),
            {"n": name, "now": now},
        )
        preset_id = result.fetchone()[0]
        await db.commit()
    return preset_id


async def _create_node(name: str = "TestNode") -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO nodes (name, url, proxmox_node, verify_ssl, "
                "token_id, token_secret, viewer_token_id, viewer_token_secret, "
                "operator_token_id, operator_token_secret, admin_token_id, admin_token_secret, "
                "packer_token_id, packer_token_secret, cluster_nodes, poll_interval, "
                "is_default, created_at, created_by) "
                "VALUES (:n, 'https://pve.local:8006', 'pve', 1, "
                "'', '', '', '', '', '', '', '', '', '', '', 30, 1, :now, 'system') "
                "RETURNING id"
            ),
            {"n": name, "now": now},
        )
        node_id = result.fetchone()[0]
        await db.commit()
    return node_id


# ── Auth guards ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_pools_unauthenticated(client):
    r = await client.get("/api/pools")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_pool_operator_403(client):
    r = await client.post(
        "/api/pools",
        json={"name": "Pool1"},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_pool_operator_403(client):
    r = await client.delete(
        "/api/pools/1",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


# ── Plus-gate (Core = 0 pools) ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_pool_core_edition_blocked(client, monkeypatch):
    """Core edition has CORE_MAX_POOLS = 0 → POST must return 403."""
    monkeypatch.setattr(plus_behavior, "get_max_pools", lambda: 0)

    r = await client.post(
        "/api/pools",
        json={"name": "Pool1"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 403
    assert "Plus" in r.json()["detail"] or "Core" in r.json()["detail"]


# ── Happy path: admin creates and reads pools ─────────────────────────────────

@pytest.mark.asyncio
async def test_list_pools_empty_admin(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.get("/api/pools", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_pool_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.post(
        "/api/pools",
        json={"name": "MyPool", "description": "Test pool", "cpu_quota": 10, "vm_count_quota": 5},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "MyPool"
    assert data["cpu_quota"] == 10
    assert data["vm_count_quota"] == 5
    assert data["members"] == []
    assert data["assignments"] == []


@pytest.mark.asyncio
async def test_create_pool_manager_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.post(
        "/api/pools",
        json={"name": "ManagerPool"},
        headers={"Authorization": f"Bearer {_MANAGE_TOKEN}"},
    )
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_create_pool_name_conflict_409(client, monkeypatch):
    _patch_plus(monkeypatch)
    for _ in range(2):
        r = await client.post(
            "/api/pools",
            json={"name": "DupPool"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_create_pool_name_too_short_422(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.post(
        "/api/pools",
        json={"name": "X"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_pool_negative_quota_422(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.post(
        "/api/pools",
        json={"name": "ValidName", "cpu_quota": -1},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_get_pool_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools",
        json={"name": "GetMePool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    pool_id = create_r.json()["id"]

    r = await client.get(
        f"/api/pools/{pool_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "GetMePool"


@pytest.mark.asyncio
async def test_get_pool_not_found(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.get(
        "/api/pools/99999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_pool_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools",
        json={"name": "OriginalPool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    pool_id = create_r.json()["id"]

    r = await client.put(
        f"/api/pools/{pool_id}",
        json={"name": "RenamedPool", "cpu_quota": 20},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "RenamedPool"
    assert data["cpu_quota"] == 20


@pytest.mark.asyncio
async def test_delete_pool_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools",
        json={"name": "DeleteMePool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    pool_id = create_r.json()["id"]

    r = await client.delete(
        f"/api/pools/{pool_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204

    # Pool should no longer exist
    r2 = await client.get(
        f"/api/pools/{pool_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_delete_pool_not_found(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.delete(
        "/api/pools/99999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── Tags ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_tags_empty(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.get("/api/pools/tags", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200
    assert r.json()["tags"] == []


@pytest.mark.asyncio
async def test_get_tags_returns_pool(client, monkeypatch):
    _patch_plus(monkeypatch)
    await client.post(
        "/api/pools",
        json={"name": "TaggedPool", "tags": ["alpha", "beta"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.get("/api/pools/tags", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200
    tags = r.json()["tags"]
    assert "alpha" in tags
    assert "beta" in tags


@pytest.mark.asyncio
async def test_get_tags_operator_403(client):
    r = await client.get("/api/pools/tags", headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"})
    assert r.status_code == 403


# ── Members ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_member_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    create_r = await client.post(
        "/api/pools",
        json={"name": "MemberPool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    pool_id = create_r.json()["id"]

    r = await client.post(
        f"/api/pools/{pool_id}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 100},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["vmid"] == 100


@pytest.mark.asyncio
async def test_add_member_duplicate_409(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n2")
    create_r = await client.post(
        "/api/pools",
        json={"name": "DupMemberPool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    pool_id = create_r.json()["id"]

    for _ in range(2):
        r = await client.post(
            f"/api/pools/{pool_id}/members",
            json={"resource_type": "vm", "node_id": node_id, "vmid": 200},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_add_member_to_second_pool_409(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n3")
    p1_r = await client.post(
        "/api/pools", json={"name": "Pool-A"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    p2_r = await client.post(
        "/api/pools", json={"name": "Pool-B"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pid1, pid2 = p1_r.json()["id"], p2_r.json()["id"]

    await client.post(
        f"/api/pools/{pid1}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 300},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.post(
        f"/api/pools/{pid2}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 300},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_remove_member_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n4")
    create_r = await client.post(
        "/api/pools", json={"name": "RemMemberPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]
    await client.post(
        f"/api/pools/{pool_id}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 400},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.delete(
        f"/api/pools/{pool_id}/members/{node_id}/400",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_remove_member_not_found(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools", json={"name": "EmptyPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]
    r = await client.delete(
        f"/api/pools/{pool_id}/members/1/999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── Assignments ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_assignment_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    preset_id = await _create_preset()
    user_id = await _create_user("alice_pool")
    create_r = await client.post(
        "/api/pools", json={"name": "AssignPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    r = await client.post(
        f"/api/pools/{pool_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["subject_id"] == user_id
    assert data["role_preset_id"] == preset_id


@pytest.mark.asyncio
async def test_add_assignment_invalid_preset(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools", json={"name": "AssignPool2"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    r = await client.post(
        f"/api/pools/{pool_id}/assignments",
        json={"subject_type": "user", "subject_id": 1, "role_preset_id": 99999},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_remove_assignment_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    preset_id = await _create_preset("P2")
    user_id = await _create_user("bob_pool")
    create_r = await client.post(
        "/api/pools", json={"name": "RmAssignPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]
    await client.post(
        f"/api/pools/{pool_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.delete(
        f"/api/pools/{pool_id}/assignments/user/{user_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_remove_assignment_invalid_subject_type(client):
    r = await client.delete(
        "/api/pools/1/assignments/robot/5",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_remove_assignment_not_found(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools", json={"name": "NoAssignPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]
    r = await client.delete(
        f"/api/pools/{pool_id}/assignments/user/9999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── delete-preview ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_preview_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools", json={"name": "PreviewPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    r = await client.get(
        f"/api/pools/{pool_id}/delete-preview",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["member_count"] == 0
    assert data["assignment_count"] == 0
    assert data["name"] == "PreviewPool"


@pytest.mark.asyncio
async def test_delete_preview_not_found(client, monkeypatch):
    _patch_plus(monkeypatch)
    r = await client.get(
        "/api/pools/99999/delete-preview",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── Usage endpoint ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_usage_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools", json={"name": "UsagePool", "vm_count_quota": 5},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    r = await client.get(
        f"/api/pools/{pool_id}/usage",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["pool_id"] == pool_id
    assert data["vm_count"]["quota"] == 5
    assert data["vm_count"]["used"] == 0
    assert data["is_over_quota"] is False


@pytest.mark.asyncio
async def test_get_usage_not_found(client):
    r = await client.get(
        "/api/pools/99999/usage",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── GET /api/me/pools ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_my_pools_empty(client):
    await _create_user("mypool_user")
    token = create_access_token("mypool_user", role="operator", auth_type="local")
    r = await client.get("/api/me/pools", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_my_pools_with_assignment(client, monkeypatch):
    _patch_plus(monkeypatch)
    preset_id = await _create_preset("P3")
    user_id = await _create_user("carl_pool")
    token = create_access_token("carl_pool", role="operator", auth_type="local")

    create_r = await client.post(
        "/api/pools", json={"name": "CarlsPool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]
    await client.post(
        f"/api/pools/{pool_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )

    r = await client.get("/api/me/pools", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    pools = r.json()
    assert len(pools) == 1
    assert pools[0]["name"] == "CarlsPool"


# ── Bulk members ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_bulk_add_members_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n5")
    create_r = await client.post(
        "/api/pools", json={"name": "BulkPool"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    r = await client.post(
        f"/api/pools/{pool_id}/members:bulk",
        json={"members": [
            {"resource_type": "vm", "node_id": node_id, "vmid": 501},
            {"resource_type": "lxc", "node_id": node_id, "vmid": 502},
        ]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_bulk_add_conflict_409(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n6")
    create_r = await client.post(
        "/api/pools", json={"name": "BulkPool2"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]
    # First add
    await client.post(
        f"/api/pools/{pool_id}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 601},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    # Bulk including existing vmid
    r = await client.post(
        f"/api/pools/{pool_id}/members:bulk",
        json={"members": [{"resource_type": "vm", "node_id": node_id, "vmid": 601}]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 409


# ── VM pool move ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_move_vm_pool_success(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n7")
    p1_r = await client.post(
        "/api/pools", json={"name": "MovePoolA"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    p2_r = await client.post(
        "/api/pools", json={"name": "MovePoolB"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pid1, pid2 = p1_r.json()["id"], p2_r.json()["id"]

    # Add VM to pool1
    await client.post(
        f"/api/pools/{pid1}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 701},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )

    # Move to pool2
    r = await client.put(
        f"/api/vms/{node_id}/701/pool",
        json={"pool_id": pid2},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["pool_id"] == pid2


@pytest.mark.asyncio
async def test_move_vm_remove_from_pool(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n8")
    create_r = await client.post(
        "/api/pools", json={"name": "MovePoolC"}, headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    await client.post(
        f"/api/pools/{pool_id}/members",
        json={"resource_type": "vm", "node_id": node_id, "vmid": 801},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )

    r = await client.put(
        f"/api/vms/{node_id}/801/pool",
        json={"pool_id": None},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["pool_id"] is None


@pytest.mark.asyncio
async def test_move_vm_target_pool_not_found(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("n9")
    r = await client.put(
        f"/api/vms/{node_id}/901/pool",
        json={"pool_id": 99999},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── Operator pool visibility ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_operator_no_access_to_pool_403(client, monkeypatch):
    _patch_plus(monkeypatch)
    create_r = await client.post(
        "/api/pools", json={"name": "AdminOnlyPool"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"}
    )
    pool_id = create_r.json()["id"]

    r = await client.get(
        f"/api/pools/{pool_id}",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


# ── Helpers ───────────────────────────────────────────────────────────────────

def _patch_plus(monkeypatch):
    """Patch hooks to behave as Plus-edition (unlimited pools)."""
    monkeypatch.setattr(plus_behavior, "get_max_pools", lambda: None)
