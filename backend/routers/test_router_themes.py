# p3portal.org
from __future__ import annotations

import json
from unittest.mock import patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.themes import router, preferences_router

app = FastAPI()
app.include_router(router)
app.include_router(preferences_router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")

_VALID_THEME = {
    "name": "Corporate Blue",
    "variables": {
        "--sidebar": "#001f3f",
        "--bg": "#003366",
        "--bg2": "#004080",
        "--bg3": "#005099",
        "--border": "#005099",
        "--border2": "#0060b3",
        "--text": "#ccddff",
        "--text2": "#99bbff",
        "--text3": "#6699dd",
        "--white": "#eeeeff",
        "--accent": "#0080ff",
        "--green": "#00cc66",
        "--orange": "#ff9900",
        "--blue": "#0080ff",
        "--purple": "#9966ff",
        "--red": "#ff3333",
        "--font": "'Inter', sans-serif",
        "--radius-card": "8px",
        "--radius-btn": "4px",
    },
}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    from backend.services.theme_service import seed_builtin_themes
    await init_db()
    await seed_builtin_themes()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_list_themes_authenticated(client):
    r = await client.get("/api/themes", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()}
    assert {"dark", "p3orange", "light", "hc"}.issubset(ids)


@pytest.mark.asyncio
async def test_list_themes_unauthenticated(client):
    r = await client.get("/api/themes")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_each_builtin_has_vars(client):
    r = await client.get("/api/themes", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    for theme in r.json():
        assert "--accent" in theme["vars"], f"Theme {theme['id']} missing --accent"


@pytest.mark.asyncio
async def test_get_global_default_public(client):
    r = await client.get("/api/themes/default")
    assert r.status_code == 200
    assert r.json()["theme_id"] == "dark"


@pytest.mark.asyncio
async def test_set_global_default_admin(client):
    r = await client.post(
        "/api/themes/default",
        json={"theme_id": "p3orange"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_set_global_default_non_admin(client):
    r = await client.post(
        "/api/themes/default",
        json={"theme_id": "light"},
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_upload_theme_no_plus(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=False):
        content = json.dumps(_VALID_THEME).encode()
        r = await client.post(
            "/api/themes/upload",
            files={"file": ("corp.json", content, "application/json")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_theme_with_plus(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        content = json.dumps(_VALID_THEME).encode()
        r = await client.post(
            "/api/themes/upload",
            files={"file": ("corp.json", content, "application/json")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Corporate Blue"
    assert body["is_builtin"] is False


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_theme_invalid_json(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.post(
            "/api/themes/upload",
            files={"file": ("bad.json", b"not json", "application/json")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_theme_missing_vars(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        bad = {"name": "Incomplete", "variables": {"--accent": "#ff0000"}}
        r = await client.post(
            "/api/themes/upload",
            files={"file": ("inc.json", json.dumps(bad).encode(), "application/json")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_delete_builtin_theme_rejected(client):
    r = await client.delete(
        "/api/themes/dark",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_delete_nonexistent_theme(client):
    r = await client.delete(
        "/api/themes/nonexistent-xyz",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_then_delete_custom_theme(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        content = json.dumps(_VALID_THEME).encode()
        r = await client.post(
            "/api/themes/upload",
            files={"file": ("corp.json", content, "application/json")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 201
    theme_id = r.json()["id"]

    r = await client.delete(
        f"/api/themes/{theme_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_preferences_get_empty(client):
    r = await client.get(
        "/api/me/preferences",
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "theme_id" in body
    assert "lang_code" in body


@pytest.mark.asyncio
async def test_preferences_set_and_get(client):
    r = await client.patch(
        "/api/me/preferences",
        json={"theme_id": "p3orange", "lang_code": "en"},
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 204

    r = await client.get(
        "/api/me/preferences",
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["theme_id"] == "p3orange"
    assert body["lang_code"] == "en"


@pytest.mark.asyncio
async def test_preferences_unauthenticated(client):
    r = await client.get("/api/me/preferences")
    assert r.status_code == 401


# ── POST /api/themes (editor create) ─────────────────────────────────────────

_EDITOR_PAYLOAD = {
    "name": "Editor Theme",
    "variables": {
        "--sidebar": "#111111",
        "--bg": "#222222",
        "--bg2": "#333333",
        "--bg3": "#444444",
        "--border": "#555555",
        "--border2": "#666666",
        "--text": "#eeeeee",
        "--text2": "#dddddd",
        "--text3": "#cccccc",
        "--white": "#ffffff",
        "--accent": "#ff6600",
        "--green": "#00cc44",
        "--orange": "#ff6600",
        "--blue": "#0066ff",
        "--purple": "#9900ff",
        "--red": "#ff0000",
        "--radius-card": "8px",
        "--radius-btn": "4px",
        "--font": "'Inter', sans-serif",
    },
}


@pytest.mark.asyncio
async def test_create_theme_editor_no_plus(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=False):
        r = await client.post(
            "/api/themes",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_create_theme_editor_with_plus(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.post(
            "/api/themes",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Editor Theme"
    assert body["is_builtin"] is False
    assert "--accent" in body["vars"]


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_create_theme_editor_missing_vars(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        bad = {"name": "Incomplete", "variables": {"--accent": "#ff0000"}}
        r = await client.post(
            "/api/themes",
            json=bad,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_create_theme_editor_non_admin(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.post(
            "/api/themes",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
        )
    assert r.status_code == 403


# ── PUT /api/themes/{id} ──────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_update_theme_builtin_rejected(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.put(
            "/api/themes/dark",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_update_theme_not_found(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.put(
            "/api/themes/nonexistent-xyz",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_update_theme_no_plus(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        create_r = await client.post(
            "/api/themes",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    theme_id = create_r.json()["id"]

    with patch("backend.core.plus_protocol.is_plus_edition", return_value=False):
        r = await client.put(
            f"/api/themes/{theme_id}",
            json={**_EDITOR_PAYLOAD, "name": "Updated Name"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_update_theme_success(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        create_r = await client.post(
            "/api/themes",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        assert create_r.status_code == 201
        theme_id = create_r.json()["id"]

        updated = {**_EDITOR_PAYLOAD, "name": "Updated Theme", "variables": {**_EDITOR_PAYLOAD["variables"], "--accent": "#abcdef"}}
        r = await client.put(
            f"/api/themes/{theme_id}",
            json=updated,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Updated Theme"
    assert body["vars"]["--accent"] == "#abcdef"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_update_theme_name_conflict(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r1 = await client.post(
            "/api/themes",
            json=_EDITOR_PAYLOAD,
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        r2 = await client.post(
            "/api/themes",
            json={**_EDITOR_PAYLOAD, "name": "Second Theme"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        second_id = r2.json()["id"]

        # Try to rename second to first's name
        r = await client.put(
            f"/api/themes/{second_id}",
            json={**_EDITOR_PAYLOAD, "name": "Editor Theme"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 409
