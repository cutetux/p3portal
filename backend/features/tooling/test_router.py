# p3portal.org
"""PROJ-66: Tests für die Tooling-Health-Router-Endpoints (3 EPs + Auth + Rate-Limit)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.tooling.router import router
from backend.features.tooling.schemas import ToolStatus

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")

_HDR_VIEWER = {"Authorization": f"Bearer {_VIEWER_TOKEN}"}
_HDR_ADMIN = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}

_READY_STATUS = ToolStatus(
    tool="ansible",
    status="ready",
    version="2.18.1",
    last_check=datetime(2026, 5, 19, 12, 0, 0, tzinfo=timezone.utc),
    stdout="ok",
    stderr="",
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


# ── GET /api/system/tooling/status ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_status_requires_auth(client):
    resp = await client.get("/api/system/tooling/status")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_status_returns_unknown_initial(client):
    """Frischer Service ohne Check → 'unknown'."""
    from backend.features.tooling.service import ToolingHealthService
    fresh_svc = ToolingHealthService()

    with patch("backend.features.tooling.router.tooling_service", fresh_svc):
        resp = await client.get("/api/system/tooling/status", headers=_HDR_VIEWER)

    assert resp.status_code == 200
    data = resp.json()
    assert "ansible" in data
    assert data["ansible"]["status"] == "unknown"
    assert "packer" in data


@pytest.mark.asyncio
async def test_status_returns_cached_ready(client):
    """Cache mit ready-Status → Response enthält ready."""
    from backend.features.tooling.service import ToolingHealthService

    svc = ToolingHealthService()
    svc._cache["ansible"] = _READY_STATUS
    svc._cache["packer"] = ToolStatus(tool="packer", status="ready", version="1.11.2",
                                       last_check=datetime.now(timezone.utc))

    with patch("backend.features.tooling.router.tooling_service", svc):
        resp = await client.get("/api/system/tooling/status", headers=_HDR_VIEWER)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ansible"]["status"] == "ready"
    assert data["ansible"]["version"] == "2.18.1"


# ── POST /api/system/tooling/recheck ────────────────────────────────────────

@pytest.mark.asyncio
async def test_recheck_requires_auth(client):
    resp = await client.post("/api/system/tooling/recheck")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_recheck_returns_fresh_status(client):
    """Erfolgreicher Recheck liefert aktuellen Status."""
    from backend.features.tooling.service import ToolingHealthService

    svc = ToolingHealthService()

    async def fake_run_all(bypass_cache=False, user_id=None):
        svc._cache["ansible"] = ToolStatus(tool="ansible", status="ready",
                                            version="2.18.1", last_check=datetime.now(timezone.utc))
        svc._cache["packer"] = ToolStatus(tool="packer", status="ready",
                                           version="1.11.2", last_check=datetime.now(timezone.utc))
        svc._initial_check_done.set()

    svc.run_all_checks = fake_run_all

    with patch("backend.features.tooling.router.tooling_service", svc):
        resp = await client.post("/api/system/tooling/recheck", headers=_HDR_ADMIN)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ansible"]["status"] == "ready"


@pytest.mark.asyncio
async def test_recheck_rate_limit_429(client):
    """Zweiter Recheck binnen 30 s → 429 mit Retry-After-Header."""
    from backend.features.tooling.service import ToolingHealthService

    svc = ToolingHealthService()
    # Simuliere: Rate-Limit für diesen User bereits gesetzt (user_id=None für JWT-ohne-DB-User)
    svc._mark_rate_limit(None, "ansible")
    svc._mark_rate_limit(None, "packer")

    async def fake_run_all(bypass_cache=False, user_id=None):
        pass

    svc.run_all_checks = fake_run_all

    with patch("backend.features.tooling.router.tooling_service", svc):
        resp = await client.post("/api/system/tooling/recheck", headers=_HDR_VIEWER)

    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    data = resp.json()
    assert data["detail"]["detail"] == "rate_limited"


# ── GET /api/system/tooling/audit-history ────────────────────────────────────

@pytest.mark.asyncio
async def test_audit_history_requires_auth(client):
    resp = await client.get("/api/system/tooling/audit-history")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_audit_history_empty_on_fresh_db(client):
    """Leere DB → leere History."""
    resp = await client.get(
        "/api/system/tooling/audit-history?tool=ansible",
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tool"] == "ansible"
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_audit_history_returns_events(client):
    """Geschriebene Audit-Events werden korrekt zurückgegeben."""
    from backend.features.tooling.audit import emit_status_transition
    from backend.db.database import get_db
    from sqlalchemy import text

    # Direkt in audit_logs schreiben (via Service-Funktion)
    payload = json.dumps({
        "tool": "ansible",
        "from": "ready",
        "to": "down",
        "version": "2.18.1",
        "stderr_excerpt": "ansible: error",
    })
    async with get_db() as db:
        await db.execute(
            text(
                "INSERT INTO audit_logs (event_type, username, auth_type, detail, created_at) "
                "VALUES ('tooling_status_changed', NULL, 'tooling', :detail, '2026-05-19T12:00:00')"
            ),
            {"detail": payload},
        )
        await db.commit()

    resp = await client.get(
        "/api/system/tooling/audit-history?tool=ansible&limit=10",
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["tool"] == "ansible"
    assert item["from_status"] == "ready"
    assert item["to_status"] == "down"
    assert item["version"] == "2.18.1"


@pytest.mark.asyncio
async def test_audit_history_limit_param(client):
    """limit-Parameter wird akzeptiert (≥1, ≤100)."""
    resp = await client.get(
        "/api/system/tooling/audit-history?tool=packer&limit=5",
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_audit_history_invalid_limit(client):
    """limit=0 → 422 (Pydantic-Validation)."""
    resp = await client.get(
        "/api/system/tooling/audit-history?tool=ansible&limit=0",
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 422
