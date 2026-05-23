# p3portal.org
"""Tests for PROJ-21 Setup-Wizard API."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.setup import router as setup_router

app = FastAPI()
app.include_router(setup_router)

_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_OP_TOKEN    = create_access_token("op",    auth_type="local", role="operator")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "proxmox_node", "")  # fresh install – no env node


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/setup/status ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_status_fresh_install(client: AsyncClient):
    resp = await client.get("/api/setup/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["setup_required"] is True
    assert data["has_admin"] is False
    assert data["has_node"] is False


@pytest.mark.asyncio
async def test_status_always_public(client: AsyncClient):
    """Status endpoint must work without auth."""
    resp = await client.get("/api/setup/status")
    assert resp.status_code == 200


# ── POST /api/setup/admin ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_admin_creates_user(client: AsyncClient):
    resp = await client.post("/api/setup/admin", json={
        "username": "myadmin",
        "password": "securepassword1",
        "confirm_password": "securepassword1",
    })
    assert resp.status_code == 201
    assert resp.json()["username"] == "myadmin"


@pytest.mark.asyncio
async def test_setup_admin_password_mismatch(client: AsyncClient):
    resp = await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "securepassword1",
        "confirm_password": "different-pass1",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_setup_admin_password_too_short(client: AsyncClient):
    resp = await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "short",
        "confirm_password": "short",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_setup_admin_updates_existing(client: AsyncClient):
    # First call creates the user
    resp = await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "firstpassword1",
        "confirm_password": "firstpassword1",
    })
    assert resp.status_code == 201

    # Second call updates the password
    resp = await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "newpassword12345",
        "confirm_password": "newpassword12345",
    })
    assert resp.status_code == 201


# ── POST /api/setup/node ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_node_creates_node(client: AsyncClient):
    resp = await client.post("/api/setup/node", json={
        "name": "Homelab",
        "url": "https://pve.example.com:8006",
        "proxmox_node": "pve",
        "verify_ssl": False,
        "token_id": "user@pam!mytoken",
        "token_secret": "super-secret-token-value",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["ok"] is True
    assert "node_id" in data


@pytest.mark.asyncio
async def test_setup_node_invalid_url(client: AsyncClient):
    resp = await client.post("/api/setup/node", json={
        "name": "Bad",
        "url": "not-a-url",
        "proxmox_node": "pve",
        "verify_ssl": False,
        "token_id": "t",
        "token_secret": "s",
    })
    assert resp.status_code == 422


# ── POST /api/setup/test-connection ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_test_connection_called(client: AsyncClient):
    with patch(
        "backend.routers.setup.test_connection",
        new=AsyncMock(return_value={"ok": False, "version": None, "error": "Connection refused"}),
    ):
        resp = await client.post("/api/setup/test-connection", json={
            "url": "https://pve.example.com:8006",
            "token_id": "user@pam!tok",
            "token_secret": "secret",
            "verify_ssl": False,
        })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False


# ── POST /api/setup/tokens ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_tokens_saves_tokens(client: AsyncClient):
    # setup_tokens() requires a node – create one first
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "init@pam!tok", "token_secret": "init-secret",
    })
    resp = await client.post("/api/setup/tokens", json={
        "viewer_token_id": "viewer@pam!tok",
        "viewer_token_secret": "viewersecret",
        "operator_token_id": "op@pam!tok",
        "operator_token_secret": "opsecret",
        "admin_token_id": "",
        "admin_token_secret": "",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_setup_tokens_all_optional(client: AsyncClient):
    # setup_tokens() requires a node – create one first
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "init@pam!tok", "token_secret": "init-secret",
    })
    resp = await client.post("/api/setup/tokens", json={})
    assert resp.status_code == 200


# ── POST /api/setup/portal-settings ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_portal_settings(client: AsyncClient):
    resp = await client.post("/api/setup/portal-settings", json={
        "portal_name": "My P3 Portal",
        "packer_http_ip": "192.168.1.100",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── POST /api/setup/complete ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_complete_requires_node(client: AsyncClient):
    """Cannot complete setup without a configured node."""
    resp = await client.post("/api/setup/complete")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_complete_success(client: AsyncClient):
    # First create a node
    await client.post("/api/setup/node", json={
        "name": "Homelab",
        "url": "https://pve.example.com:8006",
        "proxmox_node": "pve",
        "verify_ssl": False,
        "token_id": "user@pam!tok",
        "token_secret": "secret",
    })
    resp = await client.post("/api/setup/complete")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── PROJ-55: Packer-Token in /tokens ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_tokens_includes_packer(client: AsyncClient):
    """Packer token fields are saved alongside service tokens."""
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "init@pam!tok", "token_secret": "init-secret",
    })
    resp = await client.post("/api/setup/tokens", json={
        "viewer_token_id": "viewer@pam!tok",
        "viewer_token_secret": "viewersecret",
        "packer_token_id": "portal-packer@pve!portal-packer",
        "packer_token_secret": "packersecret",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_setup_tokens_packer_optional(client: AsyncClient):
    """Omitting packer fields is still accepted."""
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "init@pam!tok", "token_secret": "init-secret",
    })
    resp = await client.post("/api/setup/tokens", json={
        "viewer_token_id": "viewer@pam!tok",
        "viewer_token_secret": "viewersecret",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── PROJ-55: Auto-Login in /complete ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_complete_first_time_returns_jwt(client: AsyncClient):
    """First completion returns access_token for auto-login."""
    await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "setuppassword1",
        "confirm_password": "setuppassword1",
    })
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "user@pam!tok", "token_secret": "secret",
    })
    resp = await client.post("/api/setup/complete")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert len(data["access_token"]) > 20


@pytest.mark.asyncio
async def test_complete_no_admin_no_jwt(client: AsyncClient):
    """Completion without admin user returns ok=True but no access_token."""
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "user@pam!tok", "token_secret": "secret",
    })
    resp = await client.post("/api/setup/complete")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "access_token" not in data


@pytest.mark.asyncio
async def test_complete_rerun_no_jwt(client: AsyncClient):
    """Re-running complete after setup is already done returns ok=True without token."""
    # Full first-time setup
    await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "setuppassword1",
        "confirm_password": "setuppassword1",
    })
    await client.post("/api/setup/node", json={
        "name": "Homelab", "url": "https://pve.example.com:8006",
        "proxmox_node": "pve", "verify_ssl": False,
        "token_id": "user@pam!tok", "token_secret": "secret",
    })
    await client.post("/api/setup/complete")

    # Re-run with admin JWT
    resp = await client.post(
        "/api/setup/complete",
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "access_token" not in data


@pytest.mark.asyncio
async def test_status_after_complete(client: AsyncClient):
    """After setup_complete=true, status requires admin JWT (PROJ-67 F-016)."""
    # Create admin
    await client.post("/api/setup/admin", json={
        "username": "admin",
        "password": "adminpassword1",
        "confirm_password": "adminpassword1",
    })
    # Create node
    await client.post("/api/setup/node", json={
        "name": "Homelab",
        "url": "https://pve.example.com:8006",
        "proxmox_node": "pve",
        "verify_ssl": False,
        "token_id": "user@pam!tok",
        "token_secret": "secret",
    })
    # Complete – returns JWT on first completion
    complete_resp = await client.post("/api/setup/complete")
    token = complete_resp.json().get("access_token")
    assert token, "Expected JWT from first /complete call"

    # Unauthenticated access must return 401 after setup
    anon_status = await client.get("/api/setup/status")
    assert anon_status.status_code == 401

    # Authenticated admin can still read status
    auth_status = await client.get(
        "/api/setup/status", headers={"Authorization": f"Bearer {token}"}
    )
    data = auth_status.json()
    assert data["setup_required"] is False
    assert data["has_admin"] is True
    assert data["has_node"] is True


# ── Auth protection after setup complete ─────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_locked_after_complete(client: AsyncClient):
    """After setup is complete, unauthenticated writes must be rejected."""
    # Setup and complete
    await client.post("/api/setup/admin", json={
        "username": "admin", "password": "adminpass1234", "confirm_password": "adminpass1234",
    })
    await client.post("/api/setup/node", json={
        "name": "H", "url": "https://x.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "t", "token_secret": "s",
    })
    await client.post("/api/setup/complete")

    # Now try without auth
    resp = await client.post("/api/setup/admin", json={
        "username": "admin2", "password": "adminpass1234", "confirm_password": "adminpass1234",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_setup_rerun_with_admin_jwt(client: AsyncClient):
    """Admin can re-run setup after it's complete."""
    # Complete setup first
    await client.post("/api/setup/admin", json={
        "username": "admin", "password": "adminpass1234", "confirm_password": "adminpass1234",
    })
    await client.post("/api/setup/node", json={
        "name": "H", "url": "https://x.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "t", "token_secret": "s",
    })
    await client.post("/api/setup/complete")

    # Re-run with admin JWT
    resp = await client.post(
        "/api/setup/portal-settings",
        json={"portal_name": "Updated Portal", "packer_http_ip": ""},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_setup_rerun_operator_rejected(client: AsyncClient):
    """Operator JWT must be rejected when setup is complete."""
    await client.post("/api/setup/admin", json={
        "username": "admin", "password": "adminpass1234", "confirm_password": "adminpass1234",
    })
    await client.post("/api/setup/node", json={
        "name": "H", "url": "https://x.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "t", "token_secret": "s",
    })
    await client.post("/api/setup/complete")

    resp = await client.post(
        "/api/setup/portal-settings",
        json={"portal_name": "X", "packer_http_ip": ""},
        headers=_auth(_OP_TOKEN),
    )
    assert resp.status_code == 403


# ── PROJ-25: POST /api/setup/database ────────────────────────────────────────

@pytest.mark.asyncio
async def test_setup_database_sqlite(client: AsyncClient, tmp_path):
    """Selecting SQLite removes .db_config and returns restart_required."""
    resp = await client.post("/api/setup/database", json={"db_type": "sqlite"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["db_type"] == "sqlite"
    assert data["restart_required"] is True


@pytest.mark.asyncio
async def test_setup_database_postgres_saves_config(client: AsyncClient, tmp_path):
    """PostgreSQL config writes .db_config."""
    # data_dir is monkeypatched to tmp_path via autouse fixture
    resp = await client.post("/api/setup/database", json={
        "db_type": "postgresql",
        "host": "db.example.com",
        "port": 5432,
        "database": "portal",
        "username": "portaluser",
        "password": "secret",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["db_type"] == "postgresql"
    assert data["restart_required"] is True

    # Verify .db_config was written
    import json
    config_file = tmp_path / ".db_config"
    assert config_file.exists()
    config = json.loads(config_file.read_text())
    assert "postgresql+asyncpg" in config["db_url"]
    assert "db.example.com" in config["db_url"]
    assert "portal" in config["db_url"]
    # Password should be URL-encoded in the URL (no raw secret exposed in key)
    assert "secret" not in config["db_url"].split("@")[0].split("//")[-1].split(":")[0]


@pytest.mark.asyncio
async def test_setup_database_postgres_missing_host(client: AsyncClient):
    """PostgreSQL without host → 422."""
    resp = await client.post("/api/setup/database", json={
        "db_type": "postgresql",
        "host": "",
        "database": "portal",
        "username": "user",
        "password": "pw",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_setup_database_postgres_missing_database(client: AsyncClient):
    """PostgreSQL without database name → 422."""
    resp = await client.post("/api/setup/database", json={
        "db_type": "postgresql",
        "host": "db.example.com",
        "database": "",
        "username": "user",
        "password": "pw",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_setup_database_invalid_type(client: AsyncClient):
    """Unknown db_type → 422."""
    resp = await client.post("/api/setup/database", json={"db_type": "mariadb"})
    assert resp.status_code == 422


# ── PROJ-25: POST /api/setup/database/test ───────────────────────────────────

@pytest.mark.asyncio
async def test_database_test_connection_success(client: AsyncClient):
    """Successful connection test returns ok=True."""
    from contextlib import asynccontextmanager

    class _FakeConn:
        async def execute(self, *a, **kw):
            return None

    @asynccontextmanager
    async def _fake_connect():
        yield _FakeConn()

    class _FakeEngine:
        def connect(self):
            return _fake_connect()
        async def dispose(self):
            pass

    with patch("sqlalchemy.ext.asyncio.create_async_engine", return_value=_FakeEngine()):
        resp = await client.post("/api/setup/database/test", json={
            "host": "db.example.com",
            "port": 5432,
            "database": "portal",
            "username": "user",
            "password": "secret",
        })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_database_test_connection_failure(client: AsyncClient):
    """Failed connection returns 400 with message (no credential leak)."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _failing_connect():
        raise Exception("auth failed for user:secret@db.example.com:5432/portal")
        yield  # make it a generator

    class _FailEngine:
        def connect(self):
            return _failing_connect()
        async def dispose(self):
            pass

    with patch("sqlalchemy.ext.asyncio.create_async_engine", return_value=_FailEngine()):
        resp = await client.post("/api/setup/database/test", json={
            "host": "db.example.com",
            "port": 5432,
            "database": "portal",
            "username": "user",
            "password": "secret",
        })
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    # Password must not appear in error message
    assert "secret" not in detail


@pytest.mark.asyncio
async def test_database_test_missing_host(client: AsyncClient):
    """Empty host → 422."""
    resp = await client.post("/api/setup/database/test", json={
        "host": "",
        "port": 5432,
        "database": "portal",
        "username": "user",
        "password": "pw",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_database_test_invalid_port(client: AsyncClient):
    """Port 0 → 422."""
    resp = await client.post("/api/setup/database/test", json={
        "host": "db.example.com",
        "port": 0,
        "database": "portal",
        "username": "user",
        "password": "pw",
    })
    assert resp.status_code == 422
