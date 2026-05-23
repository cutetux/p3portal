# p3portal.org
from __future__ import annotations

from unittest.mock import patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.i18n import router

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")

_FRENCH_YAML = (
    b"_lang_code: fr\n"
    b"_lang_name: \"Fran\xc3\xa7ais\"\n"
    b"sidebar:\n"
    b"  dashboard: Tableau de bord\n"
    b"  logout: \"Se d\xc3\xa9connecter\"\n"
    b"common:\n"
    b"  save: Enregistrer\n"
    b"  cancel: Annuler\n"
)


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_list_languages_authenticated(client):
    r = await client.get("/api/i18n/languages", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    assert r.status_code == 200
    codes = {l["code"] for l in r.json()}
    assert "de" in codes
    assert "en" in codes


@pytest.mark.asyncio
async def test_list_languages_builtin_flags(client):
    r = await client.get("/api/i18n/languages", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    for lang in r.json():
        if lang["code"] in ("de", "en"):
            assert lang["is_builtin"] is True


@pytest.mark.asyncio
async def test_list_languages_unauthenticated(client):
    r = await client.get("/api/i18n/languages")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_german_translation_public(client):
    r = await client.get("/api/i18n/de")
    assert r.status_code == 200
    body = r.json()
    assert "sidebar" in body
    assert body["sidebar"]["dashboard"] == "Dashboard"
    assert body["sidebar"]["logout"] == "Abmelden"


@pytest.mark.asyncio
async def test_get_english_translation_public(client):
    r = await client.get("/api/i18n/en")
    assert r.status_code == 200
    body = r.json()
    assert body["sidebar"]["logout"] == "Sign out"


@pytest.mark.asyncio
async def test_get_unknown_language_404(client):
    r = await client.get("/api/i18n/xx")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_default_lang_public(client):
    r = await client.get("/api/i18n/default")
    assert r.status_code == 200
    assert r.json()["lang_code"] == "de"


@pytest.mark.asyncio
async def test_set_global_default_lang_admin(client):
    r = await client.post(
        "/api/i18n/default",
        json={"lang_code": "en"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_set_global_default_lang_non_admin(client):
    r = await client.post(
        "/api/i18n/default",
        json={"lang_code": "en"},
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_upload_language_no_plus(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=False):
        r = await client.post(
            "/api/i18n/upload",
            files={"file": ("fr.yml", _FRENCH_YAML, "text/yaml")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_and_retrieve_custom_language(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.post(
            "/api/i18n/upload",
            files={"file": ("fr.yml", _FRENCH_YAML, "text/yaml")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == "fr"
        assert body["is_builtin"] is False

        r2 = await client.get("/api/i18n/fr")
        assert r2.status_code == 200
        assert r2.json()["sidebar"]["dashboard"] == "Tableau de bord"


@pytest.mark.asyncio
async def test_delete_builtin_language_rejected(client):
    r = await client.delete(
        "/api/i18n/de",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_delete_nonexistent_language(client):
    r = await client.delete(
        "/api/i18n/xx",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_then_delete_custom_language(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.post(
            "/api/i18n/upload",
            files={"file": ("fr.yml", _FRENCH_YAML, "text/yaml")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        assert r.status_code == 201

    r = await client.delete(
        "/api/i18n/fr",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204

    r = await client.get("/api/i18n/fr")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_translation_strips_meta_keys(client):
    r = await client.get("/api/i18n/de")
    assert r.status_code == 200
    body = r.json()
    for key in body:
        assert not key.startswith("_"), f"Meta key {key!r} leaked into response"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_invalid_yaml(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        bad_yaml = b"key: [unclosed bracket"
        r = await client.post(
            "/api/i18n/upload",
            files={"file": ("bad.yml", bad_yaml, "text/yaml")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_upload_builtin_lang_rejected(client):
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=True):
        r = await client.post(
            "/api/i18n/upload",
            files={"file": ("de.yml", b"sidebar:\n  dashboard: Test\n", "text/yaml")},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert r.status_code == 422
