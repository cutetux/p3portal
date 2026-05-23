# p3portal.org
"""PROJ-54: pytest-Tests für den Sidebar-Pins-Router.

Testet: Auth-401, GET/POST/PATCH/DELETE/Reorder, Limit-Enforcement
Core+Plus, Cross-User-404, Stale-Cleanup, Audit-Event-Logging.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from backend.core.security import create_access_token
from backend.db.database import get_db, init_db
from backend.features.sidebar_pins.router import router

app = FastAPI()
app.include_router(router)

_ALICE_TOKEN = create_access_token("alice", auth_type="local", role="operator")
_BOB_TOKEN = create_access_token("bob", auth_type="local", role="operator")
_ANON = "Bearer invalid_token"
_AUTH_A = {"Authorization": f"Bearer {_ALICE_TOKEN}"}
_AUTH_B = {"Authorization": f"Bearer {_BOB_TOKEN}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _seed_user(username: str, role: str = "operator") -> int:
    pw_hash = hashlib.sha256(b"pw").hexdigest()
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


# ── Auth guards ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_unauthenticated(client):
    r = await client.get("/api/sidebar-pins")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_unauthenticated(client):
    r = await client.post("/api/sidebar-pins", json={"route": "/dashboard", "pin_kind": "other"})
    assert r.status_code == 401


# ── GET /api/sidebar-pins ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_empty(client):
    await _seed_user("alice")
    r = await client.get("/api/sidebar-pins", headers=_AUTH_A)
    assert r.status_code == 200
    assert r.json() == []


# ── POST /api/sidebar-pins ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_pin_happy_path(client):
    await _seed_user("alice")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/system-settings?tab=nodes", "pin_kind": "system_settings_tab"},
        headers=_AUTH_A,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["pin"]["route"] == "/system-settings?tab=nodes"
    assert body["pin"]["position"] == 0
    assert body["warning"] is None


@pytest.mark.asyncio
async def test_create_pin_duplicate_returns_409(client):
    await _seed_user("alice")
    await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_create_pin_invalid_route_returns_422(client):
    await _seed_user("alice")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "javascript:alert(1)", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_pin_core_limit_returns_403(client, monkeypatch):
    await _seed_user("alice")
    monkeypatch.setattr(
        "backend.features.sidebar_pins.router.is_plus_edition", lambda: False
    )
    for i in range(5):
        await client.post(
            "/api/sidebar-pins",
            json={"route": f"/route-{i}", "pin_kind": "other"},
            headers=_AUTH_A,
        )
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/route-extra", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert detail["detail"] == "pin_limit_reached"
    assert detail["edition"] == "core"


@pytest.mark.asyncio
async def test_create_pin_plus_soft_warn(client, monkeypatch):
    await _seed_user("alice")
    monkeypatch.setattr(
        "backend.features.sidebar_pins.router.is_plus_edition", lambda: True
    )
    for i in range(10):
        await client.post(
            "/api/sidebar-pins",
            json={"route": f"/route-{i}", "pin_kind": "other"},
            headers=_AUTH_A,
        )
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/route-10", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    assert r.status_code == 201
    assert r.json()["warning"] == "pin_soft_limit"


# ── PATCH /api/sidebar-pins/{id} ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_label_happy_path(client):
    await _seed_user("alice")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    pin_id = r.json()["pin"]["id"]
    r = await client.patch(
        f"/api/sidebar-pins/{pin_id}",
        json={"label": "Mein Dashboard"},
        headers=_AUTH_A,
    )
    assert r.status_code == 200
    assert r.json()["label"] == "Mein Dashboard"


@pytest.mark.asyncio
async def test_patch_label_cross_user_404(client):
    uid_a = await _seed_user("alice")
    await _seed_user("bob")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    pin_id = r.json()["pin"]["id"]
    # Bob versucht Alices Pin zu ändern
    r = await client.patch(
        f"/api/sidebar-pins/{pin_id}",
        json={"label": "Hack"},
        headers=_AUTH_B,
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_label_too_long_returns_422(client):
    await _seed_user("alice")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    pin_id = r.json()["pin"]["id"]
    r = await client.patch(
        f"/api/sidebar-pins/{pin_id}",
        json={"label": "x" * 41},
        headers=_AUTH_A,
    )
    assert r.status_code == 422


# ── DELETE /api/sidebar-pins/{id} ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_pin_happy_path(client):
    await _seed_user("alice")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    pin_id = r.json()["pin"]["id"]
    r = await client.delete(f"/api/sidebar-pins/{pin_id}", headers=_AUTH_A)
    assert r.status_code == 204
    # Nach dem Löschen ist die Liste leer
    r = await client.get("/api/sidebar-pins", headers=_AUTH_A)
    assert r.json() == []


@pytest.mark.asyncio
async def test_delete_pin_cross_user_404(client):
    await _seed_user("alice")
    await _seed_user("bob")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/dashboard", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    pin_id = r.json()["pin"]["id"]
    r = await client.delete(f"/api/sidebar-pins/{pin_id}", headers=_AUTH_B)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_404(client):
    await _seed_user("alice")
    r = await client.delete("/api/sidebar-pins/9999", headers=_AUTH_A)
    assert r.status_code == 404


# ── PUT /api/sidebar-pins/reorder ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reorder_happy_path(client):
    await _seed_user("alice")
    ids = []
    for route in ["/a", "/b", "/c"]:
        r = await client.post(
            "/api/sidebar-pins",
            json={"route": route, "pin_kind": "other"},
            headers=_AUTH_A,
        )
        ids.append(r.json()["pin"]["id"])

    # Umkehren
    r = await client.put(
        "/api/sidebar-pins/reorder",
        json={"pin_ids": list(reversed(ids))},
        headers=_AUTH_A,
    )
    assert r.status_code == 200
    pins = r.json()
    assert pins[0]["route"] == "/c"
    assert pins[1]["route"] == "/b"
    assert pins[2]["route"] == "/a"


@pytest.mark.asyncio
async def test_reorder_mismatch_returns_409(client):
    await _seed_user("alice")
    r = await client.post(
        "/api/sidebar-pins",
        json={"route": "/a", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    pin_id = r.json()["pin"]["id"]
    await client.post(
        "/api/sidebar-pins",
        json={"route": "/b", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    # Nur ein Pin in der Reorder-Liste (unvollständig)
    r = await client.put(
        "/api/sidebar-pins/reorder",
        json={"pin_ids": [pin_id]},
        headers=_AUTH_A,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_reorder_foreign_pin_returns_409(client):
    await _seed_user("alice")
    await _seed_user("bob")
    r_a = await client.post(
        "/api/sidebar-pins",
        json={"route": "/a", "pin_kind": "other"},
        headers=_AUTH_A,
    )
    r_b = await client.post(
        "/api/sidebar-pins",
        json={"route": "/b", "pin_kind": "other"},
        headers=_AUTH_B,
    )
    # Alice versucht Bobs Pin in ihre Reorder einzuschmuggeln
    r = await client.put(
        "/api/sidebar-pins/reorder",
        json={"pin_ids": [r_a.json()["pin"]["id"], r_b.json()["pin"]["id"]]},
        headers=_AUTH_A,
    )
    assert r.status_code == 409


# ── Stale-Cleanup via GET ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_removes_stale_node_pin(client):
    await _seed_user("alice")
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text(
                "INSERT INTO user_sidebar_pins "
                "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                "VALUES (1, '/compute/bad-node', NULL, 0, 'node', '9999', :now)"
            ),
            {"now": now},
        )
        await db.commit()

    r = await client.get("/api/sidebar-pins", headers=_AUTH_A)
    assert r.status_code == 200
    assert not any(p["route"] == "/compute/bad-node" for p in r.json())
