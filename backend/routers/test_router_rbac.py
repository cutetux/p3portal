# p3portal.org
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.rbac import router as rbac_router
from backend.routers.admin import router as admin_router

app = FastAPI()
app.include_router(admin_router)
app.include_router(rbac_router)

_ADMIN_TOKEN  = create_access_token("admin",    auth_type="local", role="admin")
_OP_TOKEN     = create_access_token("operator", auth_type="local", role="operator")
_VIEWER_TOKEN = create_access_token("viewer",   auth_type="local", role="viewer")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def client_with_user(tmp_path):
    await init_db()
    from backend.services.local_auth import create_user
    await create_user("testuser", "SecurePass1234", "operator")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Seed: default presets ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_seed_default_presets(client: AsyncClient):
    from backend.services.rbac_service import seed_default_presets
    await seed_default_presets()
    resp = await client.get("/api/rbac/presets", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert "Viewer" in names
    assert "Operator" in names
    assert "Admin" in names


@pytest.mark.asyncio
async def test_seed_default_presets_idempotent(client: AsyncClient):
    from backend.services.rbac_service import seed_default_presets
    await seed_default_presets()
    await seed_default_presets()
    resp = await client.get("/api/rbac/presets", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert len(resp.json()) == 3


# ── GET /api/rbac/presets ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_presets_requires_admin(client: AsyncClient):
    resp = await client.get("/api/rbac/presets", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_presets_unauthorized(client: AsyncClient):
    resp = await client.get("/api/rbac/presets")
    assert resp.status_code == 401


# ── POST /api/rbac/presets ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_preset_success(client: AsyncClient):
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "VM Betreiber", "description": "Start/Stop nur", "permissions": ["view", "start", "stop"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "VM Betreiber"
    assert set(data["permissions"]) == {"view", "start", "stop"}
    assert data["assignment_count"] == 0


@pytest.mark.asyncio
async def test_create_preset_invalid_action(client: AsyncClient):
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "Bad", "permissions": ["view", "fly"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_preset_empty_name(client: AsyncClient):
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "  ", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_preset_as_operator_forbidden(client: AsyncClient):
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "Sneaky", "permissions": ["view"]},
        headers=_auth(_OP_TOKEN),
    )
    assert resp.status_code == 403


# ── PUT /api/rbac/presets/{id} ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_preset(client: AsyncClient):
    create = await client.post(
        "/api/rbac/presets",
        json={"name": "To Update", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    resp = await client.put(
        f"/api/rbac/presets/{pid}",
        json={"permissions": ["view", "start"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert set(resp.json()["permissions"]) == {"view", "start"}


@pytest.mark.asyncio
async def test_update_nonexistent_preset(client: AsyncClient):
    resp = await client.put(
        "/api/rbac/presets/9999",
        json={"name": "Ghost"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 404


# ── DELETE /api/rbac/presets/{id} ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_preset_success(client: AsyncClient):
    create = await client.post(
        "/api/rbac/presets",
        json={"name": "To Delete", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    resp = await client.delete(f"/api/rbac/presets/{pid}", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_preset_in_use_rejected(client_with_user: AsyncClient):
    create = await client_with_user.post(
        "/api/rbac/presets",
        json={"name": "InUse", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]

    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]
    await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "vm", "resource_id": 100, "preset_id": pid},
        headers=_auth(_ADMIN_TOKEN),
    )

    resp = await client_with_user.delete(f"/api/rbac/presets/{pid}", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_nonexistent_preset(client: AsyncClient):
    resp = await client.delete("/api/rbac/presets/9999", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 404


# ── GET /api/rbac/users/{id}/assignments ─────────────────────────────────────

@pytest.mark.asyncio
async def test_list_assignments_empty(client_with_user: AsyncClient):
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]
    resp = await client_with_user.get(
        f"/api/rbac/users/{uid}/assignments", headers=_auth(_ADMIN_TOKEN)
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_assignments_nonexistent_user(client: AsyncClient):
    resp = await client.get("/api/rbac/users/9999/assignments", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 404


# ── POST /api/rbac/users/{id}/assignments ────────────────────────────────────

@pytest.mark.asyncio
async def test_create_assignment_success(client_with_user: AsyncClient):
    create = await client_with_user.post(
        "/api/rbac/presets",
        json={"name": "ReadOnly", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]

    resp = await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "vm", "resource_id": 100, "preset_id": pid},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["resource_type"] == "vm"
    assert data["resource_id"] == 100
    assert data["preset_name"] == "ReadOnly"
    assert data["permissions"] == ["view"]


@pytest.mark.asyncio
async def test_create_assignment_duplicate_rejected(client_with_user: AsyncClient):
    create = await client_with_user.post(
        "/api/rbac/presets",
        json={"name": "P1", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]

    payload = {"resource_type": "vm", "resource_id": 200, "preset_id": pid}
    await client_with_user.post(f"/api/rbac/users/{uid}/assignments", json=payload, headers=_auth(_ADMIN_TOKEN))
    resp = await client_with_user.post(f"/api/rbac/users/{uid}/assignments", json=payload, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_assignment_invalid_resource_type(client_with_user: AsyncClient):
    create = await client_with_user.post(
        "/api/rbac/presets",
        json={"name": "P2", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]

    resp = await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "server", "resource_id": 100, "preset_id": pid},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_assignment_nonexistent_preset(client_with_user: AsyncClient):
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]
    resp = await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "vm", "resource_id": 100, "preset_id": 9999},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 404


# ── DELETE /api/rbac/users/{id}/assignments/{aid} ────────────────────────────

@pytest.mark.asyncio
async def test_delete_assignment_success(client_with_user: AsyncClient):
    create = await client_with_user.post(
        "/api/rbac/presets",
        json={"name": "ToRemove", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]

    assign = await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "vm", "resource_id": 300, "preset_id": pid},
        headers=_auth(_ADMIN_TOKEN),
    )
    aid = assign.json()["id"]

    resp = await client_with_user.delete(
        f"/api/rbac/users/{uid}/assignments/{aid}", headers=_auth(_ADMIN_TOKEN)
    )
    assert resp.status_code == 204

    list_resp = await client_with_user.get(
        f"/api/rbac/users/{uid}/assignments", headers=_auth(_ADMIN_TOKEN)
    )
    assert list_resp.json() == []


@pytest.mark.asyncio
async def test_delete_nonexistent_assignment(client_with_user: AsyncClient):
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]
    resp = await client_with_user.delete(
        f"/api/rbac/users/{uid}/assignments/9999", headers=_auth(_ADMIN_TOKEN)
    )
    assert resp.status_code == 404


# ── GET /api/rbac/me/permissions ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_permissions_admin_bypass(client: AsyncClient):
    resp = await client.get("/api/rbac/me/permissions", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    data = resp.json()
    assert data["bypass"] is True
    assert data["assignments"] == []


@pytest.mark.asyncio
async def test_me_permissions_local_user_no_assignments(client_with_user: AsyncClient):
    op_token = create_access_token("testuser", auth_type="local", role="operator")
    resp = await client_with_user.get("/api/rbac/me/permissions", headers=_auth(op_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["bypass"] is False
    assert data["assignments"] == []


@pytest.mark.asyncio
async def test_me_permissions_with_assignments(client_with_user: AsyncClient):
    create = await client_with_user.post(
        "/api/rbac/presets",
        json={"name": "MyPreset", "permissions": ["view", "start"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    pid = create.json()["id"]
    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]
    await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "vm", "resource_id": 500, "preset_id": pid},
        headers=_auth(_ADMIN_TOKEN),
    )

    op_token = create_access_token("testuser", auth_type="local", role="operator")
    resp = await client_with_user.get("/api/rbac/me/permissions", headers=_auth(op_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["bypass"] is False
    assert len(data["assignments"]) == 1
    assert data["assignments"][0]["resource_id"] == 500
    assert set(data["assignments"][0]["permissions"]) == {"view", "start"}


@pytest.mark.asyncio
async def test_me_permissions_unauthorized(client: AsyncClient):
    resp = await client.get("/api/rbac/me/permissions")
    assert resp.status_code == 401


# ── Backwards-compat: no assignments = no restriction ─────────────────────────

@pytest.mark.asyncio
async def test_rbac_check_permission_no_assignments_returns_false(client_with_user: AsyncClient):
    """User with zero assignments: check_permission returns False, but has_any_assignments also False."""
    from backend.services.rbac_service import check_permission, has_any_assignments
    from backend.services.local_auth import get_user_by_username
    user = await get_user_by_username("testuser")
    assert not await has_any_assignments(user["id"])
    assert not await check_permission(user["id"], 100, "vm", "start")


@pytest.mark.asyncio
async def test_rbac_check_permission_with_assignment(client_with_user: AsyncClient):
    from backend.services.rbac_service import check_permission, create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username
    user = await get_user_by_username("testuser")
    preset = await create_preset("P", "", ["view", "start"], created_by="admin")
    await create_assignment(user["id"], "vm", 100, preset.id, created_by="admin")
    assert await check_permission(user["id"], 100, "vm", "start")
    assert not await check_permission(user["id"], 100, "vm", "stop")
    assert not await check_permission(user["id"], 200, "vm", "start")


# ── User deletion cascades assignments ───────────────────────────────────────

@pytest.mark.asyncio
async def test_user_deletion_cascades_assignments(client_with_user: AsyncClient):
    from backend.services.local_auth import create_user
    from backend.services.rbac_service import list_assignments, create_preset, create_assignment

    await create_preset("CascadePreset", "", ["view"], created_by="admin")
    presets = await client_with_user.get("/api/rbac/presets", headers=_auth(_ADMIN_TOKEN))
    pid = presets.json()[0]["id"]

    users = await client_with_user.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    uid = users.json()[0]["id"]

    await client_with_user.post(
        f"/api/rbac/users/{uid}/assignments",
        json={"resource_type": "vm", "resource_id": 999, "preset_id": pid},
        headers=_auth(_ADMIN_TOKEN),
    )

    from backend.services.rbac_service import list_assignments as svc_list
    before = await svc_list(uid)
    assert len(before) == 1

    # Deactivate user (cascade DELETE not triggered by deactivation, only by hard delete via DB)
    # This test verifies the FOREIGN KEY CASCADE on the schema level via direct service call
    from backend.db.database import get_db
    from sqlalchemy import text
    async with get_db() as session:
        await session.execute(text("DELETE FROM local_users WHERE id = :id"), {"id": uid})
        await session.commit()

    after = await svc_list(uid)
    assert len(after) == 0


# ── PROJ-20: Core Edition Preset Limits ──────────────────────────────────────

@pytest.mark.asyncio
async def test_core_preset_limit_blocks_at_max(client: AsyncClient, monkeypatch):
    """Creating a preset beyond the limit must return 403 in Core edition."""
    monkeypatch.setattr("backend.core.license.CORE_MAX_PRESETS", 2)
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    from backend.services.rbac_service import create_preset
    await create_preset("P1", "", ["view"], created_by="admin")
    await create_preset("P2", "", ["start"], created_by="admin")
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "P3", "description": "", "permissions": ["view"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 403
    assert "Core Edition" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_core_preset_limit_allows_up_to_max(client: AsyncClient, monkeypatch):
    """Creating exactly max presets must succeed."""
    monkeypatch.setattr("backend.core.license.CORE_MAX_PRESETS", 2)
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    from backend.services.rbac_service import create_preset
    await create_preset("Existing", "", ["view"], created_by="admin")
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "Second", "description": "", "permissions": ["start"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_plus_edition_bypasses_preset_limit(client: AsyncClient, monkeypatch):
    """Plus edition must ignore the preset limit."""
    monkeypatch.setattr("backend.core.license.CORE_MAX_PRESETS", 1)
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    from backend.services.rbac_service import create_preset
    await create_preset("ExistingPlus", "", ["view"], created_by="admin")
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "SecondPlus", "description": "", "permissions": ["start"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201


# ── PROJ-27: manage_users permission tests ────────────────────────────────────

_MANAGE_USERS_TOKEN = create_access_token(
    "co_admin", auth_type="local", role="operator",
    portal_permissions=["manage_users"],
)


@pytest.mark.asyncio
async def test_manage_users_can_list_presets(client: AsyncClient):
    resp = await client.get("/api/rbac/presets", headers=_auth(_MANAGE_USERS_TOKEN))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_manage_users_can_create_preset(client: AsyncClient):
    resp = await client.post(
        "/api/rbac/presets",
        json={"name": "TestPreset", "description": "desc", "permissions": ["view"]},
        headers=_auth(_MANAGE_USERS_TOKEN),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_operator_without_manage_users_cannot_list_presets(client: AsyncClient):
    resp = await client.get("/api/rbac/presets", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_without_manage_users_cannot_list_presets(client: AsyncClient):
    resp = await client.get("/api/rbac/presets", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 403
