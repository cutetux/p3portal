# p3portal.org
from __future__ import annotations

import hashlib
import json

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.admin import router as admin_router
from backend.routers.user_api_keys import router as user_api_keys_router

app = FastAPI()
app.include_router(admin_router)
app.include_router(user_api_keys_router)

_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_OP_TOKEN = create_access_token("operator", auth_type="local", role="operator")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_settings(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "proxmox_host", "https://pve.test:8006")
    monkeypatch.setattr(settings, "proxmox_node", "pve")


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    # Seed a local user (operator)
    from backend.services.local_auth import create_user
    await create_user("operator", "pass", "operator")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _get_user_id(username: str) -> int:
    from backend.services.local_auth import get_user_by_username
    user = await get_user_by_username(username)
    assert user is not None
    return user["id"]


async def _enable_api_keys(client: AsyncClient, user_id: int, **kwargs) -> None:
    payload = {
        "api_keys_enabled": True,
        "api_keys_allowed_scopes": None,
        "api_keys_max_count": None,
        **kwargs,
    }
    resp = await client.put(
        f"/api/admin/users/{user_id}/api-key-settings",
        headers=_auth(_ADMIN_TOKEN),
        json=payload,
    )
    assert resp.status_code == 204


# ── Admin: API-Key-Settings ───────────────────────────────────────────────────

class TestAdminApiKeySettings:
    @pytest.mark.asyncio
    async def test_get_settings_default(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        resp = await client.get(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["api_keys_enabled"] is False
        assert data["api_keys_allowed_scopes"] is None
        assert data["api_keys_max_count"] is None

    @pytest.mark.asyncio
    async def test_get_settings_not_found(self, client: AsyncClient):
        resp = await client.get(
            "/api/admin/users/9999/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_settings_forbidden_for_operator(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        resp = await client.get(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_OP_TOKEN),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_enable_api_keys(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        resp = await client.get(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
        )
        assert resp.json()["api_keys_enabled"] is True

    @pytest.mark.asyncio
    async def test_set_allowed_scopes(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        resp = await client.put(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
            json={
                "api_keys_enabled": True,
                "api_keys_allowed_scopes": ["cluster:read", "jobs:read"],
                "api_keys_max_count": 3,
            },
        )
        assert resp.status_code == 204
        settings_resp = await client.get(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
        )
        data = settings_resp.json()
        assert sorted(data["api_keys_allowed_scopes"]) == ["cluster:read", "jobs:read"]
        assert data["api_keys_max_count"] == 3

    @pytest.mark.asyncio
    async def test_invalid_scope_rejected(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        resp = await client.put(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
            json={
                "api_keys_enabled": True,
                "api_keys_allowed_scopes": ["admin:all"],
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_max_count_out_of_range_rejected(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        resp = await client.put(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
            json={"api_keys_enabled": True, "api_keys_max_count": 100},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_disable_deactivates_all_keys(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)

        # Create a key as operator
        op_token = create_access_token("operator", auth_type="local", role="operator")
        create_resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "ci-key", "scopes": ["cluster:read"]},
        )
        assert create_resp.status_code == 201
        key_id = create_resp.json()["id"]

        # Admin disables API keys for this user
        await client.put(
            f"/api/admin/users/{user_id}/api-key-settings",
            headers=_auth(_ADMIN_TOKEN),
            json={"api_keys_enabled": False, "api_keys_allowed_scopes": None},
        )

        # Key should now be inactive
        from backend.db.database import get_db
        from sqlalchemy import text
        async with get_db() as session:
            result = await session.execute(
                text("SELECT is_active FROM user_api_keys WHERE id = :id"), {"id": key_id}
            )
            row = result.fetchone()
        assert row is not None
        assert row[0] == 0


# ── Profile: User API Keys CRUD ───────────────────────────────────────────────

class TestUserApiKeysCrud:
    @pytest.mark.asyncio
    async def test_list_forbidden_when_disabled(self, client: AsyncClient):
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.get("/api/profile/api-keys", headers=_auth(op_token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_forbidden_when_disabled(self, client: AsyncClient):
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "key", "scopes": ["cluster:read"]},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_and_list(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)

        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "my-key", "scopes": ["cluster:read", "jobs:read"]},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "plaintext_key" in data
        assert data["plaintext_key"].startswith("upk_")
        assert len(data["plaintext_key"]) == 4 + 64  # "upk_" + 64 hex chars
        assert data["is_active"] is True
        assert sorted(data["scopes"]) == ["cluster:read", "jobs:read"]
        # plaintext_key not in list response
        list_resp = await client.get("/api/profile/api-keys", headers=_auth(op_token))
        assert list_resp.status_code == 200
        listed = list_resp.json()
        assert len(listed) == 1
        assert "plaintext_key" not in listed[0]
        assert listed[0]["key_prefix"] == data["key_prefix"]

    @pytest.mark.asyncio
    async def test_create_invalid_scope_rejected(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "bad", "scopes": ["admin:all"]},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_empty_scopes_rejected(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "bad", "scopes": []},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_invalid_expiry_rejected(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "bad", "scopes": ["cluster:read"], "expires_in_days": 999},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_with_no_expiry(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "permanent", "scopes": ["cluster:read"], "expires_in_days": None},
        )
        assert resp.status_code == 201
        assert resp.json()["expires_at"] is None

    @pytest.mark.asyncio
    async def test_revoke_key(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")

        create_resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "to-revoke", "scopes": ["cluster:read"]},
        )
        key_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/profile/api-keys/{key_id}", headers=_auth(op_token)
        )
        assert resp.status_code == 204

        # Second revoke should fail
        resp2 = await client.delete(
            f"/api/profile/api-keys/{key_id}", headers=_auth(op_token)
        )
        assert resp2.status_code == 404

    @pytest.mark.asyncio
    async def test_revoke_other_users_key_fails(self, client: AsyncClient):
        """A user cannot revoke another user's key."""
        from backend.services.local_auth import create_user as _create_user
        await _create_user("admin2", "pass", "admin")
        admin2_token = create_access_token("admin2", auth_type="local", role="admin")

        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")

        create_resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "mine", "scopes": ["cluster:read"]},
        )
        key_id = create_resp.json()["id"]

        # admin2 tries to revoke operator's key via profile endpoint → 404
        resp = await client.delete(
            f"/api/profile/api-keys/{key_id}", headers=_auth(admin2_token)
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_scope_restricted_by_admin(self, client: AsyncClient):
        user_id = await _get_user_id("operator")
        await _enable_api_keys(
            client, user_id, api_keys_allowed_scopes=["cluster:read"]
        )
        op_token = create_access_token("operator", auth_type="local", role="operator")
        resp = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "overreach", "scopes": ["jobs:write"]},
        )
        assert resp.status_code == 422
        assert "not allowed" in resp.json()["detail"]


# ── Edition Gate (Core: max 1 key) ───────────────────────────────────────────

class TestEditionGate:
    @pytest.mark.asyncio
    async def test_core_max_one_key(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)

        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id)
        op_token = create_access_token("operator", auth_type="local", role="operator")

        # First key should succeed
        r1 = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "key-1", "scopes": ["cluster:read"]},
        )
        assert r1.status_code == 201

        # Second key should be rejected (Core limit = 1)
        r2 = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "key-2", "scopes": ["cluster:read"]},
        )
        assert r2.status_code == 403
        assert "1" in r2.json()["detail"]

    @pytest.mark.asyncio
    @pytest.mark.plus_only
    async def test_plus_custom_max_keys(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)

        user_id = await _get_user_id("operator")
        await _enable_api_keys(client, user_id, api_keys_max_count=2)
        op_token = create_access_token("operator", auth_type="local", role="operator")

        r1 = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "key-1", "scopes": ["cluster:read"]},
        )
        assert r1.status_code == 201

        r2 = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "key-2", "scopes": ["cluster:read"]},
        )
        assert r2.status_code == 201

        r3 = await client.post(
            "/api/profile/api-keys",
            headers=_auth(op_token),
            json={"name": "key-3", "scopes": ["cluster:read"]},
        )
        assert r3.status_code == 403


# ── upk_ Auth in get_current_user ─────────────────────────────────────────────

class TestUpkAuth:
    @pytest.mark.asyncio
    async def test_valid_upk_authenticates(self, client: AsyncClient):
        """A valid upk_ token can call get_current_user successfully."""
        from fastapi import FastAPI as _FA
        from fastapi import Depends
        from backend.core.deps import get_current_user, CurrentUser

        _app = _FA()

        @_app.get("/test-me")
        async def _me(user: CurrentUser = Depends(get_current_user)):
            return {"username": user.username, "scopes": user.scopes or []}

        _app.include_router(user_api_keys_router)

        async with AsyncClient(
            transport=ASGITransport(app=_app), base_url="http://test"
        ) as ac:
            # Seed user + enable keys
            user_id = await _get_user_id("operator")
            op_token = create_access_token("operator", auth_type="local", role="operator")
            await client.put(
                f"/api/admin/users/{user_id}/api-key-settings",
                headers=_auth(_ADMIN_TOKEN),
                json={"api_keys_enabled": True, "api_keys_allowed_scopes": None},
            )

            create_resp = await ac.post(
                "/api/profile/api-keys",
                headers=_auth(op_token),
                json={"name": "test-key", "scopes": ["cluster:read", "jobs:read"]},
            )
            assert create_resp.status_code == 201
            upk_key = create_resp.json()["plaintext_key"]

            me_resp = await ac.get("/test-me", headers=_auth(upk_key))
            assert me_resp.status_code == 200
            data = me_resp.json()
            assert data["username"] == "operator"
            assert sorted(data["scopes"]) == ["cluster:read", "jobs:read"]

    @pytest.mark.asyncio
    async def test_revoked_upk_rejected(self, client: AsyncClient):
        from fastapi import FastAPI as _FA
        from fastapi import Depends
        from backend.core.deps import get_current_user, CurrentUser

        _app = _FA()
        _app.include_router(user_api_keys_router)

        @_app.get("/test-me")
        async def _me(user: CurrentUser = Depends(get_current_user)):
            return {"username": user.username}

        async with AsyncClient(
            transport=ASGITransport(app=_app), base_url="http://test"
        ) as ac:
            user_id = await _get_user_id("operator")
            op_token = create_access_token("operator", auth_type="local", role="operator")
            await client.put(
                f"/api/admin/users/{user_id}/api-key-settings",
                headers=_auth(_ADMIN_TOKEN),
                json={"api_keys_enabled": True, "api_keys_allowed_scopes": None},
            )

            create_resp = await ac.post(
                "/api/profile/api-keys",
                headers=_auth(op_token),
                json={"name": "rev-key", "scopes": ["cluster:read"]},
            )
            data = create_resp.json()
            key_id = data["id"]
            upk_key = data["plaintext_key"]

            # Revoke via profile endpoint
            await ac.delete(f"/api/profile/api-keys/{key_id}", headers=_auth(op_token))

            # Now key must be rejected
            resp = await ac.get("/test-me", headers=_auth(upk_key))
            assert resp.status_code == 401
            assert "revoked" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_unknown_upk_rejected(self, client: AsyncClient):
        from fastapi import FastAPI as _FA
        from fastapi import Depends
        from backend.core.deps import get_current_user, CurrentUser

        _app = _FA()

        @_app.get("/test-me")
        async def _me(user: CurrentUser = Depends(get_current_user)):
            return {"username": user.username}

        async with AsyncClient(
            transport=ASGITransport(app=_app), base_url="http://test"
        ) as ac:
            resp = await ac.get(
                "/test-me",
                headers=_auth("upk_" + "0" * 64),
            )
            assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_admin_disables_key_immediately(self, client: AsyncClient):
        """After admin disables api_keys, all upk_ tokens must fail."""
        from fastapi import FastAPI as _FA
        from fastapi import Depends
        from backend.core.deps import get_current_user, CurrentUser

        _app = _FA()
        _app.include_router(user_api_keys_router)

        @_app.get("/test-me")
        async def _me(user: CurrentUser = Depends(get_current_user)):
            return {"username": user.username}

        async with AsyncClient(
            transport=ASGITransport(app=_app), base_url="http://test"
        ) as ac:
            user_id = await _get_user_id("operator")
            op_token = create_access_token("operator", auth_type="local", role="operator")
            await client.put(
                f"/api/admin/users/{user_id}/api-key-settings",
                headers=_auth(_ADMIN_TOKEN),
                json={"api_keys_enabled": True, "api_keys_allowed_scopes": None},
            )
            create_resp = await ac.post(
                "/api/profile/api-keys",
                headers=_auth(op_token),
                json={"name": "alive", "scopes": ["cluster:read"]},
            )
            upk_key = create_resp.json()["plaintext_key"]

            # Key works
            assert (
                await ac.get("/test-me", headers=_auth(upk_key))
            ).status_code == 200

            # Admin revokes access
            await client.put(
                f"/api/admin/users/{user_id}/api-key-settings",
                headers=_auth(_ADMIN_TOKEN),
                json={"api_keys_enabled": False, "api_keys_allowed_scopes": None},
            )

            # Key should now fail
            resp = await ac.get("/test-me", headers=_auth(upk_key))
            assert resp.status_code == 401


# ── Service unit tests ────────────────────────────────────────────────────────

class TestUserApiKeyService:
    @pytest.mark.asyncio
    async def test_key_format(self, tmp_path):
        await init_db()
        from backend.services.user_api_key_service import _generate_key
        plaintext, key_hash, prefix = _generate_key()
        assert plaintext.startswith("upk_")
        assert len(plaintext) == 4 + 64   # "upk_" + 64 hex chars
        assert len(key_hash) == 64        # SHA-256
        assert prefix == plaintext[:12]

    @pytest.mark.asyncio
    async def test_create_and_authenticate(self, tmp_path):
        await init_db()
        from backend.services.local_auth import create_user
        from backend.services.user_api_key_service import (
            authenticate_user_key,
            create_user_key,
        )
        user = await create_user("svc-test", "pw", "operator")

        # Enable api keys for user directly in DB
        from backend.db.database import get_db
        from sqlalchemy import text
        async with get_db() as session:
            await session.execute(
                text("UPDATE local_users SET api_keys_enabled = 1 WHERE id = :id"),
                {"id": user.id},
            )
            await session.commit()

        row, plaintext = await create_user_key(
            user_id=user.id,
            name="test",
            scopes=["cluster:read"],
            expires_in_days=365,
            allowed_scopes=None,
        )
        info = await authenticate_user_key(plaintext)
        assert info is not None
        assert info["username"] == "svc-test"
        assert info["scopes"] == ["cluster:read"]

    @pytest.mark.asyncio
    async def test_unknown_key_returns_none(self, tmp_path):
        await init_db()
        from backend.services.user_api_key_service import authenticate_user_key
        result = await authenticate_user_key("upk_" + "0" * 64)
        assert result is None

    @pytest.mark.asyncio
    async def test_revoked_key_raises(self, tmp_path):
        await init_db()
        from backend.services.local_auth import create_user
        from backend.services.user_api_key_service import (
            authenticate_user_key,
            create_user_key,
            revoke_user_key,
        )
        user = await create_user("svc-rev", "pw", "operator")
        from backend.db.database import get_db
        from sqlalchemy import text
        async with get_db() as session:
            await session.execute(
                text("UPDATE local_users SET api_keys_enabled = 1 WHERE id = :id"),
                {"id": user.id},
            )
            await session.commit()
        row, plaintext = await create_user_key(user.id, "rev", ["jobs:read"], 90, None)
        await revoke_user_key(row.id, user.id)
        with pytest.raises(ValueError, match="revoked"):
            await authenticate_user_key(plaintext)

    @pytest.mark.asyncio
    async def test_expired_key_raises(self, tmp_path):
        await init_db()
        from datetime import datetime, timedelta, timezone
        from backend.services.local_auth import create_user
        from backend.services.user_api_key_service import create_user_key, authenticate_user_key
        user = await create_user("svc-exp", "pw", "operator")
        from backend.db.database import get_db
        from sqlalchemy import text
        async with get_db() as session:
            await session.execute(
                text("UPDATE local_users SET api_keys_enabled = 1 WHERE id = :id"),
                {"id": user.id},
            )
            await session.commit()
        row, plaintext = await create_user_key(user.id, "exp", ["jobs:read"], 365, None)
        # Force expiry in DB
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        async with get_db() as session:
            await session.execute(
                text("UPDATE user_api_keys SET expires_at = :exp WHERE id = :id"),
                {"exp": past, "id": row.id},
            )
            await session.commit()
        with pytest.raises(ValueError, match="expired"):
            await authenticate_user_key(plaintext)

    @pytest.mark.asyncio
    async def test_scope_validation_in_service(self, tmp_path):
        await init_db()
        from backend.services.local_auth import create_user
        from backend.services.user_api_key_service import create_user_key
        user = await create_user("svc-scope", "pw", "operator")
        with pytest.raises(ValueError, match="Unknown scopes"):
            await create_user_key(user.id, "bad", ["admin:all"], 30, None)

    @pytest.mark.asyncio
    async def test_allowed_scopes_enforcement(self, tmp_path):
        await init_db()
        from backend.services.local_auth import create_user
        from backend.services.user_api_key_service import create_user_key
        user = await create_user("svc-allowed", "pw", "operator")
        with pytest.raises(ValueError, match="not allowed"):
            await create_user_key(
                user.id, "overreach", ["jobs:write"], 30, allowed_scopes=["cluster:read"]
            )
