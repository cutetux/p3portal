# p3portal.org
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.announcements import router

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_OPERATOR_TOKEN = create_access_token("operator", role="operator")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_PERM_TOKEN = create_access_token(
    "manager",
    role="operator",
    portal_permissions=["manage_announcements"],
)

_FUTURE_DATE = "2099-01-01T00:00:00+00:00"
_PAST_DATE = "2000-01-01T00:00:00+00:00"


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/announcements (public authenticated) ─────────────────────────────

@pytest.mark.asyncio
async def test_get_active_unauthenticated(client):
    r = await client.get("/api/announcements")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_active_empty(client):
    r = await client.get("/api/announcements", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    assert r.status_code == 200
    assert r.json() == []


# ── POST /api/admin/announcements ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_announcement_admin(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Wartung morgen", "severity": "warn", "active": True},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["message"] == "Wartung morgen"
    assert body["severity"] == "warn"
    assert body["active"] is True
    assert body["expires_at"] is None
    assert body["created_by"] == "admin"
    assert "id" in body


@pytest.mark.asyncio
async def test_create_announcement_severity_default_info(client):
    """Severity defaults to 'info' when not provided (AC-SEVERITY)."""
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Info-Banner"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["severity"] == "info"


@pytest.mark.asyncio
async def test_create_announcement_all_severities(client):
    """All four valid severities are accepted."""
    for sev in ("info", "warn", "critical", "success"):
        r = await client.post(
            "/api/admin/announcements",
            json={"message": f"Sev-{sev}", "severity": sev},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        assert r.status_code == 201, f"severity={sev} rejected"
        assert r.json()["severity"] == sev


@pytest.mark.asyncio
async def test_create_announcement_with_permission(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Info-Banner", "severity": "info"},
        headers={"Authorization": f"Bearer {_PERM_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["created_by"] == "manager"


@pytest.mark.asyncio
async def test_create_announcement_forbidden_viewer(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Forbidden", "severity": "info"},
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_announcement_forbidden_operator(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Forbidden", "severity": "info"},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_empty_message_rejected(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "   ", "severity": "info"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_invalid_severity_rejected(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Test", "severity": "unknown"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_past_expires_at_rejected(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Test", "severity": "info", "expires_at": _PAST_DATE},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_future_expires_at_accepted(client):
    r = await client.post(
        "/api/admin/announcements",
        json={"message": "Befristete Meldung", "severity": "info", "expires_at": _FUTURE_DATE},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["expires_at"] == _FUTURE_DATE


# ── GET /api/admin/announcements ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_list_requires_admin(client):
    r = await client.get(
        "/api/admin/announcements",
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_list_includes_inactive(client):
    await client.post(
        "/api/admin/announcements",
        json={"message": "Aktiv", "severity": "info", "active": True},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    await client.post(
        "/api/admin/announcements",
        json={"message": "Inaktiv", "severity": "info", "active": False},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.get(
        "/api/admin/announcements",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    messages = {a["message"] for a in r.json()}
    assert "Aktiv" in messages
    assert "Inaktiv" in messages


# ── GET /api/announcements filters correctly ──────────────────────────────────

@pytest.mark.asyncio
async def test_public_endpoint_excludes_inactive(client):
    await client.post(
        "/api/admin/announcements",
        json={"message": "Sichtbar", "severity": "info", "active": True},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    await client.post(
        "/api/admin/announcements",
        json={"message": "Versteckt", "severity": "info", "active": False},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.get("/api/announcements", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    assert r.status_code == 200
    messages = [a["message"] for a in r.json()]
    assert "Sichtbar" in messages
    assert "Versteckt" not in messages


@pytest.mark.asyncio
async def test_public_endpoint_excludes_expired(client):
    await client.post(
        "/api/admin/announcements",
        json={"message": "Nicht abgelaufen", "severity": "info", "expires_at": _FUTURE_DATE},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    from backend.services import announcement_service
    await announcement_service.create(
        message="Abgelaufen",
        severity="warn",
        active=True,
        expires_at=_PAST_DATE,
        created_by="test",
    )
    r = await client.get("/api/announcements", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    messages = [a["message"] for a in r.json()]
    assert "Nicht abgelaufen" in messages
    assert "Abgelaufen" not in messages


# ── PUT /api/admin/announcements/{id} ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_announcement(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Original", "severity": "info", "active": True},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.put(
        f"/api/admin/announcements/{ann_id}",
        json={"message": "Aktualisiert", "active": False},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == "Aktualisiert"
    assert body["active"] is False
    assert body["severity"] == "info"  # unchanged


@pytest.mark.asyncio
async def test_update_severity(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Wartung", "severity": "info"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.put(
        f"/api/admin/announcements/{ann_id}",
        json={"severity": "critical"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["severity"] == "critical"


@pytest.mark.asyncio
async def test_update_nonexistent_returns_404(client):
    r = await client.put(
        "/api/admin/announcements/99999",
        json={"message": "Ghost"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_clear_expires_at(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Mit Ablauf", "severity": "info", "expires_at": _FUTURE_DATE},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.put(
        f"/api/admin/announcements/{ann_id}",
        json={"expires_at": None},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["expires_at"] is None


@pytest.mark.asyncio
async def test_update_keep_expires_at_when_omitted(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Mit Ablauf", "severity": "info", "expires_at": _FUTURE_DATE},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.put(
        f"/api/admin/announcements/{ann_id}",
        json={"message": "Neuer Text"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["expires_at"] == _FUTURE_DATE


# ── DELETE /api/admin/announcements/{id} ──────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_announcement(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Zu löschen", "severity": "critical"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.delete(
        f"/api/admin/announcements/{ann_id}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 204

    r = await client.get(
        "/api/admin/announcements",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ids = [a["id"] for a in r.json()]
    assert ann_id not in ids


@pytest.mark.asyncio
async def test_delete_nonexistent_returns_404(client):
    r = await client.delete(
        "/api/admin/announcements/99999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_forbidden_viewer(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Gesichert", "severity": "info"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.delete(
        f"/api/admin/announcements/{ann_id}",
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert r.status_code == 403


# ── manage_announcements permission ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_manage_perm_allows_admin_list(client):
    r = await client.get(
        "/api/admin/announcements",
        headers={"Authorization": f"Bearer {_PERM_TOKEN}"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_manage_perm_allows_delete(client):
    create_r = await client.post(
        "/api/admin/announcements",
        json={"message": "Löschen mit Permission", "severity": "info"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    ann_id = create_r.json()["id"]

    r = await client.delete(
        f"/api/admin/announcements/{ann_id}",
        headers={"Authorization": f"Bearer {_PERM_TOKEN}"},
    )
    assert r.status_code == 204


# ── AC-SEVERITY: Migration smoke test ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_severity_constraint_enforced(client):
    """Check-Constraint rejects unknown severity values."""
    from backend.db.database import get_db
    from sqlalchemy import text
    async with get_db() as session:
        import pytest
        with pytest.raises(Exception):
            await session.execute(
                text("INSERT INTO announcements (message, severity, active, created_by, created_at, updated_at) "
                     "VALUES ('test', 'invalid', 1, 'sys', '2024-01-01', '2024-01-01')")
            )
            await session.commit()
