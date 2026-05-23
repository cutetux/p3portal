# p3portal.org
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.admin import router as admin_router
from backend.routers.auth import router as auth_router
from backend.routers.profile import router as profile_router

app = FastAPI()
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(profile_router)

# ── Token helpers ─────────────────────────────────────────────────────────────
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
async def client_with_admin(tmp_path):
    """Client with one seeded admin user."""
    await init_db()
    from backend.services.local_auth import create_user
    await create_user("admin", "AdminPass1234", "admin")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/me ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_returns_user_info(client: AsyncClient):
    resp = await client.get("/api/me", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert data["auth_type"] == "local"
    assert data["role"] == "admin"


@pytest.mark.asyncio
async def test_me_unauthorized(client: AsyncClient):
    resp = await client.get("/api/me")
    assert resp.status_code == 401


# ── POST /api/auth/login/local ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_local_login_success(client_with_admin: AsyncClient):
    resp = await client_with_admin.post(
        "/api/auth/login/local",
        json={"username": "admin", "password": "AdminPass1234"},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_local_login_wrong_password(client_with_admin: AsyncClient):
    resp = await client_with_admin.post(
        "/api/auth/login/local",
        json={"username": "admin", "password": "WrongPassword99"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_local_login_unknown_user(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login/local",
        json={"username": "ghost", "password": "doesnotmatter"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_local_login_inactive_user(client: AsyncClient):
    from backend.services.local_auth import create_user, update_user
    user = await create_user("inactive", "InactivePass123", "operator")
    await update_user(user.id, password=None, role=None, active=False)

    resp = await client.post(
        "/api/auth/login/local",
        json={"username": "inactive", "password": "InactivePass123"},
    )
    assert resp.status_code == 401


# ── GET /api/admin/users ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_users_as_admin(client: AsyncClient):
    resp = await client.get("/api/admin/users", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_list_users_as_operator_forbidden(client: AsyncClient):
    resp = await client.get("/api/admin/users", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_users_as_viewer_forbidden(client: AsyncClient):
    resp = await client.get("/api/admin/users", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_users_unauthorized(client: AsyncClient):
    resp = await client.get("/api/admin/users")
    assert resp.status_code == 401


# ── POST /api/admin/users ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_user_success(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users",
        json={"username": "helpdesk", "password": "SecurePass123", "role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "helpdesk"
    assert data["role"] == "operator"
    assert data["active"] is True


@pytest.mark.asyncio
async def test_create_user_duplicate(client: AsyncClient):
    payload = {"username": "dup", "password": "SecurePass123", "role": "viewer"}
    await client.post("/api/admin/users", json=payload, headers=_auth(_ADMIN_TOKEN))
    resp = await client.post("/api/admin/users", json=payload, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_user_at_sign_rejected(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users",
        json={"username": "bad@user", "password": "SecurePass123", "role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_short_password(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users",
        json={"username": "shortpw", "password": "tooshort", "role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_invalid_role(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users",
        json={"username": "badrole", "password": "SecurePass123", "role": "superuser"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_as_operator_forbidden(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users",
        json={"username": "newuser", "password": "SecurePass123", "role": "viewer"},
        headers=_auth(_OP_TOKEN),
    )
    assert resp.status_code == 403


# ── PATCH /api/admin/users/{id} ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_user_role(client: AsyncClient):
    create_resp = await client.post(
        "/api/admin/users",
        json={"username": "patchme", "password": "SecurePass123", "role": "viewer"},
        headers=_auth(_ADMIN_TOKEN),
    )
    user_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/admin/users/{user_id}",
        json={"role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "operator"


@pytest.mark.asyncio
async def test_patch_deactivate_user(client: AsyncClient):
    create_resp = await client.post(
        "/api/admin/users",
        json={"username": "deactivate", "password": "SecurePass123", "role": "viewer"},
        headers=_auth(_ADMIN_TOKEN),
    )
    user_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/admin/users/{user_id}",
        json={"active": False},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["active"] is False


@pytest.mark.asyncio
async def test_patch_last_admin_lockout_protection(client: AsyncClient):
    """Removing the last active admin must return 409."""
    from backend.services.local_auth import create_user
    user = await create_user("only_admin", "AdminPass1234", "admin")

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"active": False},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_patch_nonexistent_user(client: AsyncClient):
    resp = await client.patch(
        "/api/admin/users/9999",
        json={"role": "viewer"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_as_operator_forbidden(client: AsyncClient):
    from backend.services.local_auth import create_user
    user = await create_user("target", "SecurePass123", "viewer")

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"role": "operator"},
        headers=_auth(_OP_TOKEN),
    )
    assert resp.status_code == 403


# ── POST /api/admin/users/{id}/reset-password ─────────────────────────────────

@pytest.mark.asyncio
async def test_reset_password_success(client: AsyncClient):
    from backend.services.local_auth import create_user
    user = await create_user("resetme", "OldPassword123", "operator")

    resp = await client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "TempPass5678"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_sets_must_change_flag(client: AsyncClient):
    from backend.services.local_auth import create_user, get_user_by_username
    user = await create_user("flagtest", "OldPassword123", "operator")

    await client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "TempPass5678"},
        headers=_auth(_ADMIN_TOKEN),
    )
    row = await get_user_by_username("flagtest")
    assert row["must_change_password"] == 1


@pytest.mark.asyncio
async def test_reset_password_login_carries_must_change_flag(client_with_admin: AsyncClient):
    from backend.services.local_auth import create_user
    import json as _json, base64 as _b64

    user = await create_user("mustchange", "OldPassword123", "operator")
    await client_with_admin.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "TempPass5678"},
        headers=_auth(_ADMIN_TOKEN),
    )
    resp = await client_with_admin.post(
        "/api/auth/login/local",
        json={"username": "mustchange", "password": "TempPass5678"},
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    payload = _json.loads(_b64.b64decode(token.split(".")[1] + "=="))
    assert payload.get("must_change_pw") is True


@pytest.mark.asyncio
async def test_reset_password_too_short(client: AsyncClient):
    from backend.services.local_auth import create_user
    user = await create_user("shortpw2", "OldPassword123", "operator")

    resp = await client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "short"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reset_password_operator_forbidden(client: AsyncClient):
    from backend.services.local_auth import create_user
    user = await create_user("victim", "OldPassword123", "operator")

    resp = await client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "TempPass5678"},
        headers=_auth(_OP_TOKEN),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reset_password_not_found(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users/9999/reset-password",
        json={"new_password": "TempPass5678"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 404


# ── PROJ-20: Core Edition User Limits ────────────────────────────────────────

@pytest.mark.asyncio
async def test_core_user_limit_blocks_at_max(client: AsyncClient, monkeypatch):
    """Creating the 7th user must fail with 403 in Core edition."""
    from backend.core import license as lic_mod
    monkeypatch.setattr(lic_mod, "CORE_MAX_USERS", 3)
    monkeypatch.setattr("backend.core.license.CORE_MAX_USERS", 3)
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    from backend.services.local_auth import create_user
    await create_user("u1", "Password123", "operator")
    await create_user("u2", "Password123", "operator")
    await create_user("u3", "Password123", "admin")
    resp = await client.post(
        "/api/admin/users",
        json={"username": "u4", "password": "Password123", "role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 403
    assert "Core Edition" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_core_user_limit_allows_up_to_max(client: AsyncClient, monkeypatch):
    """Creating exactly max users must succeed."""
    monkeypatch.setattr("backend.core.license.CORE_MAX_USERS", 3)
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    from backend.services.local_auth import create_user
    await create_user("existing1", "Password123", "operator")
    await create_user("existing2", "Password123", "operator")
    resp = await client.post(
        "/api/admin/users",
        json={"username": "third", "password": "Password123", "role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_plus_edition_bypasses_user_limit(client: AsyncClient, monkeypatch):
    """Plus edition must ignore the user limit entirely."""
    monkeypatch.setattr("backend.core.license.CORE_MAX_USERS", 1)
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    resp = await client.post(
        "/api/admin/users",
        json={"username": "plususer", "password": "Password123", "role": "operator"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201


# ── PROJ-27: manage_users permission tests ────────────────────────────────────

_MANAGE_USERS_TOKEN = create_access_token(
    "co_admin", auth_type="local", role="operator",
    portal_permissions=["manage_users"],
)
_MANAGE_SETTINGS_TOKEN = create_access_token(
    "settings_mgr", auth_type="local", role="viewer",
    portal_permissions=["manage_settings"],
)


@pytest.mark.asyncio
async def test_manage_users_can_list_users(client: AsyncClient):
    resp = await client.get("/api/admin/users", headers=_auth(_MANAGE_USERS_TOKEN))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_manage_users_can_create_user(client: AsyncClient):
    resp = await client.post(
        "/api/admin/users",
        json={"username": "newuser", "password": "Password123", "role": "viewer"},
        headers=_auth(_MANAGE_USERS_TOKEN),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_operator_without_permission_cannot_list_users(client: AsyncClient):
    resp = await client.get("/api/admin/users", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_without_permission_cannot_list_users(client: AsyncClient):
    resp = await client.get("/api/admin/users", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_manage_users_cannot_set_portal_permissions(client: AsyncClient):
    """portal-permissions endpoint must stay admin-only – no delegation."""
    from backend.services.local_auth import create_user
    target = await create_user("target", "Password123", "viewer")
    resp = await client.put(
        f"/api/admin/users/{target.id}/portal-permissions",
        json={"portal_permissions": ["view_logs"]},
        headers=_auth(_MANAGE_USERS_TOKEN),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_portal_permissions_validator_accepts_new_values(client: AsyncClient):
    """The updated validator must accept all PROJ-27 permission values."""
    from backend.services.local_auth import create_user
    target = await create_user("target2", "Password123", "operator")
    for perm in ("manage_users", "manage_nodes", "manage_settings", "manage_api_keys"):
        resp = await client.put(
            f"/api/admin/users/{target.id}/portal-permissions",
            json={"portal_permissions": [perm]},
            headers=_auth(_ADMIN_TOKEN),
        )
        assert resp.status_code == 200, f"Permission {perm!r} should be accepted, got {resp.status_code}"


@pytest.mark.asyncio
async def test_portal_permissions_validator_rejects_unknown(client: AsyncClient):
    from backend.services.local_auth import create_user
    target = await create_user("target3", "Password123", "operator")
    resp = await client.put(
        f"/api/admin/users/{target.id}/portal-permissions",
        json={"portal_permissions": ["manage_everything"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_manage_settings_can_get_packer_vmid_range(client: AsyncClient):
    resp = await client.get("/api/admin/settings/packer-vmid-range", headers=_auth(_MANAGE_SETTINGS_TOKEN))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_manage_settings_can_put_playbook_vmid_range(client: AsyncClient):
    resp = await client.put(
        "/api/admin/settings/playbook-vmid-range",
        json={"min": 200, "max": 5000},
        headers=_auth(_MANAGE_SETTINGS_TOKEN),
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_operator_without_permission_cannot_access_settings(client: AsyncClient):
    resp = await client.get("/api/admin/settings/packer-vmid-range", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403
