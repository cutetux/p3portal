# p3portal.org
"""PROJ-57: Router-Tests für den Help-Override-Endpoint.

Testet:
- Auth-Guards (401/403)
- GET /api/help/overrides/me
- GET /api/help/overrides/global
- POST /api/help/overrides (Upload)
- DELETE /api/help/overrides/{id}
- POST /api/help/overrides/{id}/promote (Plus-Gate)
- DELETE /api/help/global/{key}/{lang}
- GET /api/help/admin/overrides
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from io import BytesIO

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from backend.core.security import create_access_token
from backend.db.database import get_db, init_db
from backend.features.help.router import router

app = FastAPI()
app.include_router(router)

_ANON_TOKEN = ""
_OPERATOR_TOKEN = create_access_token("operator", auth_type="local", role="operator")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_MANAGE_HELP_TOKEN = create_access_token(
    "helpmanager",
    auth_type="local",
    role="operator",
    portal_permissions=["manage_help"],
)
_PROXMOX_TOKEN = create_access_token("pvuser", auth_type="proxmox", role="operator")


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _seed_local_user(username: str, role: str = "operator") -> int:
    pw_hash = hashlib.sha256(b"test").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, "
                "portal_permissions) VALUES (:u, :pw, :role, 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "role": role, "now": now},
        )
        uid = result.fetchone()[0]
        await db.commit()
    return uid


def _make_token_for_user(uid: int, username: str, role: str = "operator") -> str:
    return create_access_token(username, auth_type="local", role=role)


def _upload_form(key: str = "dashboard", lang: str = "de", content: str = "# Test\n"):
    return {
        "data": {"key": key, "lang": lang, "consent": "true"},
        "files": {"file": ("help.md", BytesIO(content.encode()), "text/markdown")},
    }


# ── Auth-Guards ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_me_overrides_unauthenticated(client):
    r = await client.get("/api/help/overrides/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_global_overrides_unauthenticated(client):
    r = await client.get("/api/help/overrides/global")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_upload_unauthenticated(client):
    form = _upload_form()
    r = await client.post("/api/help/overrides", data=form["data"], files=form["files"])
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_admin_list_requires_manage_help(client):
    r = await client.get(
        "/api/help/admin/overrides",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_promote_requires_manage_help(client):
    r = await client.post(
        "/api/help/overrides/1/promote",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


# ── GET /api/help/overrides/me ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_me_overrides_empty_for_new_user(client):
    uid = await _seed_local_user("alice")
    token = _make_token_for_user(uid, "alice")
    r = await client.get(
        "/api/help/overrides/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_me_overrides_proxmox_user_returns_empty(client):
    r = await client.get(
        "/api/help/overrides/me",
        headers={"Authorization": f"Bearer {_PROXMOX_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json() == []


# ── GET /api/help/overrides/global ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_global_overrides_empty(client):
    r = await client.get(
        "/api/help/overrides/global",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json() == []


# ── POST /api/help/overrides ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_override_happy_path(client):
    uid = await _seed_local_user("bob")
    token = _make_token_for_user(uid, "bob")
    form = _upload_form("dashboard", "de", "# Dashboard-Hilfe\n\nMein Text.\n")
    r = await client.post(
        "/api/help/overrides",
        data=form["data"],
        files=form["files"],
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["key"] == "dashboard"
    assert data["lang"] == "de"
    assert data["scope"] == "user"
    assert data["owner_user_id"] == uid
    assert "content_md5" in data


@pytest.mark.asyncio
async def test_upload_rejected_without_consent(client):
    uid = await _seed_local_user("carol")
    token = _make_token_for_user(uid, "carol")
    r = await client.post(
        "/api/help/overrides",
        data={"key": "dashboard", "lang": "de", "consent": "false"},
        files={"file": ("help.md", BytesIO(b"# Test\n"), "text/markdown")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "Einwilligung" in r.json()["detail"]


@pytest.mark.asyncio
async def test_upload_rejected_invalid_lang(client):
    uid = await _seed_local_user("dave")
    token = _make_token_for_user(uid, "dave")
    r = await client.post(
        "/api/help/overrides",
        data={"key": "dashboard", "lang": "fr", "consent": "true"},
        files={"file": ("help.md", BytesIO(b"# Test\n"), "text/markdown")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_upload_rejected_with_image(client):
    uid = await _seed_local_user("eve")
    token = _make_token_for_user(uid, "eve")
    content = b"# Test\n\n![Screenshot](./img/screen.png)\n"
    r = await client.post(
        "/api/help/overrides",
        data={"key": "dashboard", "lang": "de", "consent": "true"},
        files={"file": ("help.md", BytesIO(content), "text/markdown")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "Bilder" in r.json()["detail"]


@pytest.mark.asyncio
async def test_upload_rejected_for_proxmox_user(client):
    r = await client.post(
        "/api/help/overrides",
        data={"key": "dashboard", "lang": "de", "consent": "true"},
        files={"file": ("help.md", BytesIO(b"# Test\n"), "text/markdown")},
        headers={"Authorization": f"Bearer {_PROXMOX_TOKEN}"},
    )
    assert r.status_code == 403


# ── DELETE /api/help/overrides/{id} ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_owner_can_delete_own_override(client):
    uid = await _seed_local_user("frank")
    token = _make_token_for_user(uid, "frank")
    form = _upload_form("dashboard", "de")
    r = await client.post(
        "/api/help/overrides", data=form["data"], files=form["files"],
        headers={"Authorization": f"Bearer {token}"},
    )
    oid = r.json()["id"]
    r2 = await client.delete(
        f"/api/help/overrides/{oid}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200
    assert r2.json()["deleted_id"] == oid


@pytest.mark.asyncio
async def test_other_user_cannot_delete(client):
    uid1 = await _seed_local_user("grace")
    uid2 = await _seed_local_user("henry")
    t1 = _make_token_for_user(uid1, "grace")
    t2 = _make_token_for_user(uid2, "henry")
    form = _upload_form("dashboard", "de")
    r = await client.post(
        "/api/help/overrides", data=form["data"], files=form["files"],
        headers={"Authorization": f"Bearer {t1}"},
    )
    oid = r.json()["id"]
    r2 = await client.delete(
        f"/api/help/overrides/{oid}",
        headers={"Authorization": f"Bearer {t2}"},
    )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_delete_nonexistent_returns_404(client):
    r = await client.delete(
        "/api/help/overrides/99999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── POST /api/help/overrides/{id}/promote ─────────────────────────────────────

@pytest.mark.asyncio
async def test_promote_blocked_in_core(client, monkeypatch):
    from backend.core.plus_protocol import plus_behavior
    monkeypatch.setattr(plus_behavior, "get_max_help_global_overrides", lambda: 0)

    uid = await _seed_local_user("irene")
    t = _make_token_for_user(uid, "irene", role="admin")
    form = _upload_form("jobs", "de")
    r = await client.post(
        "/api/help/overrides", data=form["data"], files=form["files"],
        headers={"Authorization": f"Bearer {t}"},
    )
    oid = r.json()["id"]
    r2 = await client.post(
        f"/api/help/overrides/{oid}/promote",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r2.status_code == 412
    assert "Plus" in r2.json()["detail"]


@pytest.mark.asyncio
async def test_promote_happy_path_plus(client, monkeypatch):
    from backend.core.plus_protocol import plus_behavior
    monkeypatch.setattr(plus_behavior, "get_max_help_global_overrides", lambda: None)

    uid = await _seed_local_user("judy")
    t = _make_token_for_user(uid, "judy")
    form = _upload_form("packer", "en", "# Packer Help\n")
    r = await client.post(
        "/api/help/overrides", data=form["data"], files=form["files"],
        headers={"Authorization": f"Bearer {t}"},
    )
    oid = r.json()["id"]
    r2 = await client.post(
        f"/api/help/overrides/{oid}/promote",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r2.status_code == 200
    data = r2.json()
    assert data["key"] == "packer"
    assert data["lang"] == "en"


# ── DELETE /api/help/global/{key}/{lang} ──────────────────────────────────────

@pytest.mark.asyncio
async def test_remove_global_override_not_found(client):
    r = await client.delete(
        "/api/help/global/nonexistent/de",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_remove_global_invalid_lang(client):
    r = await client.delete(
        "/api/help/global/dashboard/fr",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


# ── GET /api/help/admin/overrides ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_list_overrides_empty(client):
    r = await client.get(
        "/api/help/admin/overrides",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_admin_list_overrides_with_data(client):
    uid = await _seed_local_user("kevin")
    t = _make_token_for_user(uid, "kevin")
    form = _upload_form("logs", "de", "# Logs\n")
    await client.post(
        "/api/help/overrides", data=form["data"], files=form["files"],
        headers={"Authorization": f"Bearer {t}"},
    )
    r = await client.get(
        "/api/help/admin/overrides",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert len(r.json()) >= 1


@pytest.mark.asyncio
async def test_manage_help_token_can_access_admin_list(client):
    r = await client.get(
        "/api/help/admin/overrides",
        headers={"Authorization": f"Bearer {_MANAGE_HELP_TOKEN}"},
    )
    assert r.status_code == 200
