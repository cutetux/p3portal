# p3portal.org
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.admin import router as admin_router
from backend.routers.settings import router as settings_router

app = FastAPI()
app.include_router(admin_router)
app.include_router(settings_router)

_ADMIN_TOKEN  = create_access_token("admin",    auth_type="local", role="admin")
_OP_TOKEN     = create_access_token("operator", auth_type="local", role="operator")
_VIEWER_TOKEN = create_access_token("viewer",   auth_type="local", role="viewer")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/settings/ssh-key ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_ssh_key_returns_null_when_not_set(client: AsyncClient):
    resp = await client.get("/api/settings/ssh-key", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == {"key": None}


@pytest.mark.asyncio
async def test_get_ssh_key_unauthorized(client: AsyncClient):
    resp = await client.get("/api/settings/ssh-key")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_ssh_key_returns_value_after_set(client: AsyncClient):
    await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa AAAAB3Nz test@host"},
        headers=_auth(_ADMIN_TOKEN),
    )
    resp = await client.get("/api/settings/ssh-key", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["key"] == "ssh-rsa AAAAB3Nz test@host"


# ── PUT /api/admin/settings/ssh-key ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_put_ssh_key_as_admin(client: AsyncClient):
    resp = await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa AAAAB3Nz admin@host"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_put_ssh_key_as_operator_forbidden(client: AsyncClient):
    resp = await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa AAAAB3Nz op@host"},
        headers=_auth(_OP_TOKEN),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_put_ssh_key_empty_rejected(client: AsyncClient):
    resp = await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "   "},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_ssh_key_overwrites_existing(client: AsyncClient):
    await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa first"},
        headers=_auth(_ADMIN_TOKEN),
    )
    await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa second"},
        headers=_auth(_ADMIN_TOKEN),
    )
    resp = await client.get("/api/settings/ssh-key", headers=_auth(_OP_TOKEN))
    assert resp.json()["key"] == "ssh-rsa second"


@pytest.mark.asyncio
async def test_put_ssh_key_unauthorized(client: AsyncClient):
    resp = await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa AAAA"},
    )
    assert resp.status_code == 401


# ── DELETE /api/admin/settings/ssh-key ───────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_ssh_key_as_admin(client: AsyncClient):
    await client.put(
        "/api/admin/settings/ssh-key",
        json={"key": "ssh-rsa todelete"},
        headers=_auth(_ADMIN_TOKEN),
    )
    resp = await client.delete("/api/admin/settings/ssh-key", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 204

    get_resp = await client.get("/api/settings/ssh-key", headers=_auth(_OP_TOKEN))
    assert get_resp.json()["key"] is None


@pytest.mark.asyncio
async def test_delete_ssh_key_idempotent(client: AsyncClient):
    resp = await client.delete("/api/admin/settings/ssh-key", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_ssh_key_as_operator_forbidden(client: AsyncClient):
    resp = await client.delete("/api/admin/settings/ssh-key", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_ssh_key_unauthorized(client: AsyncClient):
    resp = await client.delete("/api/admin/settings/ssh-key")
    assert resp.status_code == 401
