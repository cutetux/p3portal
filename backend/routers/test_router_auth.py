# p3portal.org
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.config import settings
from backend.routers.auth import router

# Minimal app for isolated router tests
app = FastAPI()
app.include_router(router)


@pytest.fixture(autouse=True)
def reset_shared_state():
    """Clear in-memory rate-limit and session state between tests."""
    from backend.routers.auth import _login_attempts
    from backend.services.proxmox import _sessions

    _login_attempts.clear()
    _sessions.clear()
    yield
    _login_attempts.clear()
    _sessions.clear()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


_FAKE_PVE_RESPONSE = {
    "ticket": "PVE:testuser@pam:FAKETICKET",
    "CSRFPreventionToken": "FAKE:CSRF",
    "username": "testuser@pam",
    "cap": {"vms": {"VM.Audit": 1}},
}


# ── Login ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    with patch(
        "backend.routers.auth.proxmox_client.authenticate",
        new=AsyncMock(return_value=_FAKE_PVE_RESPONSE),
    ):
        resp = await client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "secret", "realm": "pam"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_credentials(client: AsyncClient):
    import httpx as _httpx

    mock_resp = _httpx.Response(401)
    with patch(
        "backend.routers.auth.proxmox_client.authenticate",
        new=AsyncMock(side_effect=_httpx.HTTPStatusError("401", request=None, response=mock_resp)),
    ):
        resp = await client.post(
            "/api/auth/login",
            json={"username": "bad", "password": "wrong", "realm": "pam"},
        )
    assert resp.status_code == 401
    # Must not leak whether it's the username or the password that's wrong
    assert resp.json()["detail"] == "Authentication failed"


@pytest.mark.asyncio
async def test_login_rate_limit(client: AsyncClient):
    import httpx as _httpx

    mock_resp = _httpx.Response(401)
    err = _httpx.HTTPStatusError("401", request=None, response=mock_resp)
    with patch(
        "backend.routers.auth.proxmox_client.authenticate",
        new=AsyncMock(side_effect=err),
    ):
        for _ in range(5):
            await client.post(
                "/api/auth/login",
                json={"username": "x", "password": "x", "realm": "pam"},
            )
        resp = await client.post(
            "/api/auth/login",
            json={"username": "x", "password": "x", "realm": "pam"},
        )
    assert resp.status_code == 429


# ── Protected endpoint without token ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_permissions_no_token(client: AsyncClient):
    resp = await client.get("/api/me/permissions")
    assert resp.status_code in (401, 403)  # HTTPBearer: 401/403 depending on FastAPI version


@pytest.mark.asyncio
async def test_me_permissions_invalid_token(client: AsyncClient):
    resp = await client.get(
        "/api/me/permissions",
        headers={"Authorization": "Bearer not.a.valid.token"},
    )
    assert resp.status_code == 401


# ── /me/permissions with valid session ───────────────────────────────────────

@pytest.mark.asyncio
async def test_me_permissions_success(client: AsyncClient):
    # First login to populate session
    with patch(
        "backend.routers.auth.proxmox_client.authenticate",
        new=AsyncMock(return_value=_FAKE_PVE_RESPONSE),
    ):
        login_resp = await client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "secret", "realm": "pam"},
        )
    token = login_resp.json()["access_token"]

    with patch(
        "backend.routers.auth.proxmox_client.get_user_info",
        new=AsyncMock(return_value={"groups": ["admins"]}),
    ):
        resp = await client.get(
            "/api/me/permissions",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "testuser@pam"
    assert "vms" in body["capabilities"]
    assert "admins" in body["groups"]


# ── Logout ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logout_clears_session(client: AsyncClient):
    with patch(
        "backend.routers.auth.proxmox_client.authenticate",
        new=AsyncMock(return_value=_FAKE_PVE_RESPONSE),
    ):
        login_resp = await client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "secret", "realm": "pam"},
        )
    token = login_resp.json()["access_token"]

    logout_resp = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout_resp.status_code == 204

    # Session is gone → 401 on next protected call
    resp = await client.get(
        "/api/me/permissions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401
