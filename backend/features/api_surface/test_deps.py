# p3portal.org
"""Tests für PROJ-44: require_scope_for_upk() Dependency."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI, Depends
from httpx import ASGITransport, AsyncClient

from backend.core.deps import CurrentUser, get_current_user
from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.api_surface.deps import require_scope_for_upk
from backend.features.api_surface.manifest import SCOPE_ALIASES, SCOPE_MANIFEST
from backend.routers.user_api_keys import router as user_api_keys_router
from backend.routers.admin import router as admin_router


def _make_scoped_app(scope: str) -> FastAPI:
    app = FastAPI()
    app.include_router(user_api_keys_router)
    app.include_router(admin_router)

    @app.get("/protected")
    async def protected(
        user: CurrentUser = Depends(get_current_user),
        _scope: CurrentUser = Depends(require_scope_for_upk(scope)),
    ):
        return {"auth_kind": user.auth_kind, "scopes": user.scopes}

    return app


@pytest.fixture(autouse=True)
def patch_settings(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db():
    await init_db()


# ── JWT ist immer No-Op ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_jwt_always_passes_scope_check(db):
    """JWT-Auth: require_scope_for_upk ist No-Op – beliebiger Scope wird akzeptiert."""
    app = _make_scoped_app("cluster:read")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(
            "/protected",
            headers={"Authorization": f"Bearer {create_access_token('operator', auth_type='local', role='operator')}"},
        )
    assert resp.status_code == 200
    assert resp.json()["auth_kind"] == "jwt"


@pytest.mark.asyncio
async def test_jwt_passes_even_nonexistent_scope(db):
    """JWT ignoriert Scope-Prüfung vollständig."""
    app = _make_scoped_app("nonexistent:scope")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(
            "/protected",
            headers={"Authorization": f"Bearer {create_access_token('op', auth_type='local', role='operator')}"},
        )
    assert resp.status_code == 200


# ── upk_ mit fehlendem Scope → 403 (via CurrentUser mock) ────────────────────

@pytest.mark.asyncio
async def test_upk_missing_scope_returns_403_via_override(db):
    """upk_-Key ohne passendem Scope → 403 mit Scope-Hinweis (via Dependency-Override)."""
    from fastapi import FastAPI, Depends
    from backend.core.deps import CurrentUser, get_current_user
    from backend.features.api_surface.deps import require_scope_for_upk

    app = FastAPI()

    @app.get("/protected")
    async def protected(
        user: CurrentUser = Depends(get_current_user),
        _scope: CurrentUser = Depends(require_scope_for_upk("jobs:write")),
    ):
        return {"ok": True}

    # Override get_current_user um einen upk_-User zu simulieren
    def fake_upk_user():
        return CurrentUser(
            username="op",
            role="operator",
            auth_type="local",
            auth_kind="upk",
            scopes=["cluster:read"],  # nur cluster:read – kein jobs:write
            api_key_id=42,
        )

    app.dependency_overrides[get_current_user] = fake_upk_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/protected")
    assert resp.status_code == 403
    assert "scope" in resp.json()["detail"].lower()


# ── Alias-Auflösung ─────────────────────────────────────────────────────────

def test_scope_alias_jobs_start_maps_to_jobs_write():
    """jobs:start ist ein Alias für jobs:write."""
    assert SCOPE_ALIASES.get("jobs:start") == "jobs:write"


def test_scope_alias_packer_start_maps_to_packer_write():
    """packer:start ist ein Alias für packer:write."""
    assert SCOPE_ALIASES.get("packer:start") == "packer:write"


# ── Manifest-Vollständigkeit ─────────────────────────────────────────────────

def test_manifest_contains_required_scopes():
    names = {e.name for e in SCOPE_MANIFEST}
    for required in ("cluster:read", "jobs:read", "jobs:write", "packer:read", "packer:write",
                     "groups:read", "pools:read", "owners:read", "approvals:read", "approvals:approve"):
        assert required in names, f"Scope {required!r} fehlt im Manifest"


def test_manifest_entries_have_endpoints():
    for entry in SCOPE_MANIFEST:
        assert len(entry.endpoints) > 0, f"Scope {entry.name!r} hat keine Endpoints"


def test_manifest_entries_have_curl_example():
    for entry in SCOPE_MANIFEST:
        assert entry.curl_example, f"Scope {entry.name!r} hat kein curl_example"
