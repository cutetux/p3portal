# p3portal.org
"""PROJ-106 – Integrationstests für den 2FA-Login-Flow und die Enrollment-/
Admin-Endpunkte."""
from __future__ import annotations

import pyotp
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token, decode_access_token
from backend.db.database import init_db
from backend.routers.admin import router as admin_router
from backend.routers.auth import router as auth_router
from backend.routers.profile import router as profile_router
from backend.services import two_factor_service as t
from backend.services.local_auth import create_user

app = FastAPI()
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(profile_router)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _reset_state(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    from backend.routers.auth import _login_attempts, _challenge_attempts
    from backend.services import config_service
    _login_attempts.clear()
    _challenge_attempts.clear()
    config_service._cache.clear()
    yield
    _login_attempts.clear()
    _challenge_attempts.clear()
    config_service._cache.clear()


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _seed_user(username="alice", pw="AlicePass1234", role="operator") -> int:
    user = await create_user(username, pw, role)
    return user.id


async def _enable_2fa(user_id: int, username: str) -> tuple[str, list[str]]:
    """Aktiviert 2FA für einen Nutzer und gibt (secret, recovery_codes) zurück."""
    data = await t.start_enrollment(user_id, username)
    codes = await t.activate(user_id, pyotp.TOTP(data["secret"]).now())
    return data["secret"], codes


# ── Login-Flow ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_without_2fa_returns_token(client: AsyncClient):
    await _seed_user()
    resp = await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] and body["two_factor_required"] is False


@pytest.mark.asyncio
async def test_login_with_2fa_returns_pre_auth(client: AsyncClient):
    uid = await _seed_user()
    await _enable_2fa(uid, "alice")
    resp = await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["two_factor_required"] is True
    assert body["pre_auth_token"] and body["access_token"] is None


@pytest.mark.asyncio
async def test_pre_auth_token_cannot_open_routes(client: AsyncClient):
    uid = await _seed_user()
    await _enable_2fa(uid, "alice")
    resp = await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})
    pre = resp.json()["pre_auth_token"]
    # Das Halb-Token darf keine geschützte Route öffnen
    me = await client.get("/api/me", headers=_auth(pre))
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_login_2fa_success(client: AsyncClient):
    uid = await _seed_user()
    secret, _ = await _enable_2fa(uid, "alice")
    pre = (await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})).json()["pre_auth_token"]
    resp = await client.post("/api/auth/login/2fa", json={"pre_auth_token": pre, "code": pyotp.TOTP(secret).now()})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert token
    # Voll-Token öffnet geschützte Route
    me = await client.get("/api/me", headers=_auth(token))
    assert me.status_code == 200 and me.json()["username"] == "alice"


@pytest.mark.asyncio
async def test_login_2fa_wrong_code(client: AsyncClient):
    uid = await _seed_user()
    await _enable_2fa(uid, "alice")
    pre = (await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})).json()["pre_auth_token"]
    resp = await client.post("/api/auth/login/2fa", json={"pre_auth_token": pre, "code": "123123"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_2fa_recovery_code(client: AsyncClient):
    uid = await _seed_user()
    _, codes = await _enable_2fa(uid, "alice")
    pre = (await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})).json()["pre_auth_token"]
    resp = await client.post("/api/auth/login/2fa", json={"pre_auth_token": pre, "code": codes[0]})
    assert resp.status_code == 200 and resp.json()["access_token"]


@pytest.mark.asyncio
async def test_enforce_sets_must_setup_flag(client: AsyncClient):
    await _seed_user()  # kein 2FA eingerichtet
    await t.set_policy(True, [])  # global Pflicht
    resp = await client.post("/api/auth/login/local", json={"username": "alice", "password": "AlicePass1234"})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert decode_access_token(token).get("must_setup_2fa") is True
    # Profil spiegelt das Gate
    me = await client.get("/api/me", headers=_auth(token))
    assert me.json()["must_setup_2fa"] is True


# ── Enrollment (Selbstbedienung) ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_profile_setup_verify_flow(client: AsyncClient):
    await _seed_user()
    token = create_access_token("alice", auth_type="local", role="operator")

    status_resp = await client.get("/api/me/2fa", headers=_auth(token))
    assert status_resp.status_code == 200 and status_resp.json()["enabled"] is False

    setup = await client.post("/api/me/2fa/setup", headers=_auth(token))
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert "<svg" in setup.json()["qr_svg"]

    verify = await client.post(
        "/api/me/2fa/verify", headers=_auth(token), json={"code": pyotp.TOTP(secret).now()}
    )
    assert verify.status_code == 200
    assert len(verify.json()["recovery_codes"]) == 10
    assert verify.json()["access_token"]

    status_resp = await client.get("/api/me/2fa", headers=_auth(token))
    assert status_resp.json()["enabled"] is True


@pytest.mark.asyncio
async def test_profile_verify_wrong_code(client: AsyncClient):
    await _seed_user()
    token = create_access_token("alice", auth_type="local", role="operator")
    await client.post("/api/me/2fa/setup", headers=_auth(token))
    resp = await client.post("/api/me/2fa/verify", headers=_auth(token), json={"code": "000000"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_profile_disable_ok(client: AsyncClient):
    uid = await _seed_user()
    secret, _ = await _enable_2fa(uid, "alice")
    token = create_access_token("alice", auth_type="local", role="operator")
    resp = await client.post(
        "/api/me/2fa/disable", headers=_auth(token), json={"code": pyotp.TOTP(secret).now()}
    )
    assert resp.status_code == 204
    assert (await t.get_state(uid))["enabled"] is False


@pytest.mark.asyncio
async def test_profile_disable_blocked_when_enforced(client: AsyncClient):
    uid = await _seed_user()
    secret, _ = await _enable_2fa(uid, "alice")
    await t.set_policy(True, [])
    token = create_access_token("alice", auth_type="local", role="operator")
    resp = await client.post(
        "/api/me/2fa/disable", headers=_auth(token), json={"code": pyotp.TOTP(secret).now()}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_2fa_endpoints_require_local(client: AsyncClient):
    token = create_access_token("root@pam", auth_type="proxmox", role="admin")
    resp = await client.get("/api/me/2fa", headers=_auth(token))
    assert resp.status_code == 403


# ── Admin ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_reset_2fa(client: AsyncClient):
    uid = await _seed_user()
    await _enable_2fa(uid, "alice")
    admin_token = create_access_token("admin", auth_type="local", role="admin")
    resp = await client.post(f"/api/admin/users/{uid}/2fa/reset", headers=_auth(admin_token))
    assert resp.status_code == 200
    assert resp.json()["totp_enabled"] is False
    assert (await t.get_state(uid))["enabled"] is False


@pytest.mark.asyncio
async def test_admin_policy_get_put(client: AsyncClient):
    admin_token = create_access_token("admin", auth_type="local", role="admin")
    put = await client.put(
        "/api/admin/2fa/policy",
        headers=_auth(admin_token),
        json={"enforce_global": True, "enforce_roles": ["admin"]},
    )
    assert put.status_code == 200
    assert put.json()["enforce_global"] is True and put.json()["enforce_roles"] == ["admin"]
    get = await client.get("/api/admin/2fa/policy", headers=_auth(admin_token))
    assert get.json()["enforce_global"] is True


@pytest.mark.asyncio
async def test_admin_policy_requires_permission(client: AsyncClient):
    viewer = create_access_token("viewer", auth_type="local", role="viewer")
    resp = await client.get("/api/admin/2fa/policy", headers=_auth(viewer))
    assert resp.status_code == 403


# ── BUG-106-3: Recovery-Codes neu generieren ──────────────────────────────────

@pytest.mark.asyncio
async def test_recovery_regenerate(client: AsyncClient):
    uid = await _seed_user()
    _, old = await _enable_2fa(uid, "alice")
    token = create_access_token("alice", auth_type="local", role="operator")
    resp = await client.post("/api/me/2fa/recovery/regenerate", headers=_auth(token))
    assert resp.status_code == 200
    new = resp.json()["recovery_codes"]
    assert len(new) == 10 and set(new).isdisjoint(set(old))


@pytest.mark.asyncio
async def test_recovery_regenerate_requires_2fa(client: AsyncClient):
    await _seed_user()
    token = create_access_token("alice", auth_type="local", role="operator")
    resp = await client.post("/api/me/2fa/recovery/regenerate", headers=_auth(token))
    assert resp.status_code == 400
