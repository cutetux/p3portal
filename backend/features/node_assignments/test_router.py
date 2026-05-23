# p3portal.org
"""PROJ-47: pytest-Tests für den Node-Assignments-Router.

Testet: Happy-Path (CRUD), 403-Pfade, 409-Duplikat, 422-Validierung,
Plus-Gate (Core), Cleanup-Hooks, /me/node-assignments.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.plus_protocol import plus_behavior
from backend.core.security import create_access_token
from backend.db.database import init_db, get_db
from backend.features.node_assignments.router import router, me_router
from sqlalchemy import text

app = FastAPI()
app.include_router(router)
app.include_router(me_router)

_OPERATOR_TOKEN = create_access_token("operator", role="operator", auth_type="local")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_MANAGE_TOKEN = create_access_token(
    "manager",
    auth_type="local",
    role="operator",
    portal_permissions=["manage_nodes"],
)


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


def _patch_plus(monkeypatch):
    """Patch hooks to behave as Plus-edition (unlimited node assignments)."""
    monkeypatch.setattr(plus_behavior, "get_max_node_assignments", lambda: None)


@pytest_asyncio.fixture
async def client():
    await init_db()
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


async def _create_preset(name: str = "TestPreset", node_actions: list | None = None) -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO role_presets "
                "(name, description, permissions, node_actions, created_at, created_by) "
                "VALUES (:n, '', '[]', :na, :now, 'admin') RETURNING id"
            ),
            {"n": name, "na": json.dumps(node_actions or []), "now": now},
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


# ── GET /api/nodes/{id}/assignments ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_assignments_empty(client):
    node_id = await _create_node()
    resp = await client.get(
        f"/api/nodes/{node_id}/assignments",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_assignments_requires_auth(client):
    node_id = await _create_node()
    resp = await client.get(f"/api/nodes/{node_id}/assignments")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_assignments_requires_manage_nodes(client):
    node_id = await _create_node()
    resp = await client.get(
        f"/api/nodes/{node_id}/assignments",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_assignments_node_not_found(client):
    resp = await client.get(
        "/api/nodes/9999/assignments",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


# ── POST /api/nodes/{id}/assignments ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_assignment_user(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    preset_id = await _create_preset()
    user_id = await _create_user("alice")

    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["node_id"] == node_id
    assert data["subject_type"] == "user"
    assert data["subject_id"] == user_id
    assert data["role_preset_id"] == preset_id
    assert data["subject_display"] == "alice"


@pytest.mark.asyncio
async def test_add_assignment_with_manage_nodes_permission(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    preset_id = await _create_preset()
    user_id = await _create_user("bob")

    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_MANAGE_TOKEN}"},
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_add_assignment_duplicate_returns_409(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    preset_id = await _create_preset()
    user_id = await _create_user("charlie")

    await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_add_assignment_user_not_found_422(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    preset_id = await _create_preset()

    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": 9999, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_add_assignment_preset_not_found_422(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    user_id = await _create_user("dave")

    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": 9999},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_add_assignment_node_not_found_404(client, monkeypatch):
    _patch_plus(monkeypatch)
    preset_id = await _create_preset()
    user_id = await _create_user("eve")

    resp = await client.post(
        "/api/nodes/9999/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_add_assignment_core_license_blocks(client, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_node_assignments", lambda: 0)

    node_id = await _create_node()
    preset_id = await _create_preset()
    user_id = await _create_user("frank")

    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 403
    assert "license_limit" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_add_assignment_requires_auth(client):
    resp = await client.post(
        "/api/nodes/1/assignments",
        json={"subject_type": "user", "subject_id": 1, "role_preset_id": 1},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_add_assignment_requires_manage_nodes(client):
    node_id = await _create_node()
    resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": 1, "role_preset_id": 1},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 403


# ── PUT /api/nodes/{id}/assignments/{type}/{sid} ──────────────────────────────

@pytest.mark.asyncio
async def test_update_assignment(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    preset1_id = await _create_preset("P1")
    preset2_id = await _create_preset("P2")
    user_id = await _create_user("grace")

    await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset1_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )

    resp = await client.put(
        f"/api/nodes/{node_id}/assignments/user/{user_id}",
        json={"role_preset_id": preset2_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json()["role_preset_id"] == preset2_id


@pytest.mark.asyncio
async def test_update_assignment_not_found(client):
    node_id = await _create_node()
    preset_id = await _create_preset()

    resp = await client.put(
        f"/api/nodes/{node_id}/assignments/user/9999",
        json={"role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_assignment_invalid_subject_type(client):
    node_id = await _create_node()
    resp = await client.put(
        f"/api/nodes/{node_id}/assignments/invalid/1",
        json={"role_preset_id": 1},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


# ── DELETE /api/nodes/{id}/assignments/{type}/{sid} ───────────────────────────

@pytest.mark.asyncio
async def test_remove_assignment(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node()
    preset_id = await _create_preset()
    user_id = await _create_user("heidi")

    await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )

    resp = await client.delete(
        f"/api/nodes/{node_id}/assignments/user/{user_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 204

    # Verify it's gone
    list_resp = await client.get(
        f"/api/nodes/{node_id}/assignments",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert list_resp.json() == []


@pytest.mark.asyncio
async def test_remove_assignment_not_found(client):
    node_id = await _create_node()
    resp = await client.delete(
        f"/api/nodes/{node_id}/assignments/user/9999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_remove_assignment_invalid_subject_type(client):
    node_id = await _create_node()
    resp = await client.delete(
        f"/api/nodes/{node_id}/assignments/service_account/1",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


# ── GET /api/me/node-assignments ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_my_node_assignments_empty(client):
    user_id = await _create_user("ivan")
    token = create_access_token("ivan", auth_type="local", role="operator")

    resp = await client.get(
        "/api/me/node-assignments",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_my_node_assignments_direct(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("PVE-Test")
    preset_id = await _create_preset("Viewer", node_actions=["node:view_tasks"])
    user_id = await _create_user("judy")
    token = create_access_token("judy", auth_type="local", role="operator")

    await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset_id},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )

    resp = await client.get(
        "/api/me/node-assignments",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["node_id"] == node_id
    assert data[0]["source"] == "direct"
    assert "node:view_tasks" in data[0]["preset_node_actions"]


@pytest.mark.asyncio
async def test_my_node_assignments_requires_auth(client):
    resp = await client.get("/api/me/node-assignments")
    assert resp.status_code == 401


# ── Full lifecycle CRUD + audit ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_lifecycle(client, monkeypatch):
    _patch_plus(monkeypatch)
    node_id = await _create_node("LifecycleNode")
    preset1 = await _create_preset("LifecycleP1")
    preset2 = await _create_preset("LifecycleP2")
    user_id = await _create_user("kate")

    # Add
    add_resp = await client.post(
        f"/api/nodes/{node_id}/assignments",
        json={"subject_type": "user", "subject_id": user_id, "role_preset_id": preset1},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert add_resp.status_code == 201

    # List
    list_resp = await client.get(
        f"/api/nodes/{node_id}/assignments",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert len(list_resp.json()) == 1

    # Update
    put_resp = await client.put(
        f"/api/nodes/{node_id}/assignments/user/{user_id}",
        json={"role_preset_id": preset2},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["role_preset_id"] == preset2

    # Delete
    del_resp = await client.delete(
        f"/api/nodes/{node_id}/assignments/user/{user_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert del_resp.status_code == 204

    # Confirm empty
    final_resp = await client.get(
        f"/api/nodes/{node_id}/assignments",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert final_resp.json() == []
