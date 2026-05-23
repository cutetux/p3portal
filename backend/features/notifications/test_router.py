# p3portal.org
"""PROJ-65: Tests für Notification Hub Router."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.notifications.router import router

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_OPERATOR_TOKEN = create_access_token("operator", role="operator")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")

_HDR_VIEWER = {"Authorization": f"Bearer {_VIEWER_TOKEN}"}
_HDR_OPERATOR = {"Authorization": f"Bearer {_OPERATOR_TOKEN}"}
_HDR_ADMIN = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# GET /api/notifications/unread-summary
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unread_summary_requires_auth(client):
    resp = await client.get("/api/notifications/unread-summary")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_unread_summary_returns_schema(client):
    resp = await client.get("/api/notifications/unread-summary", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    body = resp.json()
    assert "alerts" in body
    assert "announcements" in body
    assert "events" in body
    assert "total" in body
    assert "max_severity" in body


@pytest.mark.asyncio
async def test_unread_summary_viewer_no_alerts(client):
    """Viewer hat keine Alerts → alerts=0."""
    resp = await client.get("/api/notifications/unread-summary", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["alerts"] == 0


@pytest.mark.asyncio
async def test_unread_summary_non_negative(client):
    resp = await client.get("/api/notifications/unread-summary", headers=_HDR_OPERATOR)
    body = resp.json()
    assert body["alerts"] >= 0
    assert body["announcements"] >= 0
    assert body["events"] >= 0
    assert body["total"] >= 0


# ---------------------------------------------------------------------------
# GET /api/notifications
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_notifications_requires_auth(client):
    resp = await client.get("/api/notifications?tab=announcements")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_notifications_announcements_tab_empty(client):
    resp = await client.get("/api/notifications?tab=announcements", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_notifications_alerts_tab_viewer_empty(client):
    """Viewer sieht keine Alerts."""
    resp = await client.get("/api/notifications?tab=alerts", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_notifications_events_tab(client):
    resp = await client.get("/api/notifications?tab=events", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_notifications_invalid_tab(client):
    resp = await client.get("/api/notifications?tab=invalid", headers=_HDR_VIEWER)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_notifications_default_tab(client):
    """Default-Tab (kein Parameter) liefert 200."""
    resp = await client.get("/api/notifications", headers=_HDR_VIEWER)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_notifications_limit_zero_rejected(client):
    resp = await client.get("/api/notifications?tab=announcements&limit=0", headers=_HDR_VIEWER)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_notifications_limit_max_valid(client):
    resp = await client.get("/api/notifications?tab=announcements&limit=500", headers=_HDR_VIEWER)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_notifications_limit_over_max_rejected(client):
    resp = await client.get("/api/notifications?tab=announcements&limit=501", headers=_HDR_VIEWER)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_notifications_item_schema(client):
    """Wenn Announcements vorhanden sind, hat jedes Item die erwarteten Felder."""
    from backend.services.announcement_service import create
    await create(
        message="Test-Ankündigung",
        severity="warn",
        active=True,
        expires_at=None,
        created_by="test",
    )

    resp = await client.get("/api/notifications?tab=announcements", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 1
    item = items[0]
    assert "source" in item
    assert "source_id" in item
    assert "severity" in item
    assert "title" in item
    assert "created_at" in item
    assert "read" in item
    assert "link" in item


# ---------------------------------------------------------------------------
# POST /api/notifications/read
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mark_read_requires_auth(client):
    resp = await client.post(
        "/api/notifications/read",
        json={"source": "announcement", "source_ids": ["1"]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_mark_read_valid_announcement(client):
    resp = await client.post(
        "/api/notifications/read",
        json={"source": "announcement", "source_ids": ["1", "2"]},
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "marked" in body
    assert isinstance(body["marked"], int)


@pytest.mark.asyncio
async def test_mark_read_valid_alert(client):
    resp = await client.post(
        "/api/notifications/read",
        json={"source": "alert", "source_ids": ["42"]},
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_mark_read_valid_event(client):
    resp = await client.post(
        "/api/notifications/read",
        json={"source": "event", "source_ids": ["job:1"]},
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_mark_read_invalid_source(client):
    resp = await client.post(
        "/api/notifications/read",
        json={"source": "unknown", "source_ids": ["1"]},
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_mark_read_empty_list_rejected(client):
    resp = await client.post(
        "/api/notifications/read",
        json={"source": "announcement", "source_ids": []},
        headers=_HDR_VIEWER,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_mark_read_idempotent(client):
    """Doppeltes Markieren darf keinen Fehler erzeugen."""
    payload = {"source": "announcement", "source_ids": ["999"]}
    resp1 = await client.post("/api/notifications/read", json=payload, headers=_HDR_VIEWER)
    resp2 = await client.post("/api/notifications/read", json=payload, headers=_HDR_VIEWER)
    assert resp1.status_code == 200
    assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_mark_read_then_shows_as_read(client):
    """Nach dem Markieren erscheint das Item in tab=announcements als read=True."""
    from datetime import datetime, timezone
    from sqlalchemy import text
    from backend.db.database import get_db
    from backend.services.announcement_service import create
    from backend.core.security import create_access_token

    # Lokalen Nutzer erstellen damit user_id aufgelöst werden kann
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        r = await session.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at) "
                "VALUES ('notif_viewer', 'x', 'viewer', 1, :now) RETURNING id"
            ),
            {"now": now},
        )
        await session.commit()

    token = create_access_token("notif_viewer", role="viewer")
    hdrs = {"Authorization": f"Bearer {token}"}

    row = await create(
        message="Lese-Test",
        severity="info",
        active=True,
        expires_at=None,
        created_by="test",
    )
    ann_id = str(row["id"])

    # Vorher: ungelesen
    r1 = await client.get("/api/notifications?tab=announcements", headers=hdrs)
    items_before = [i for i in r1.json() if i["source_id"] == ann_id]
    assert len(items_before) == 1
    assert items_before[0]["read"] is False

    # Markieren
    r2 = await client.post(
        "/api/notifications/read",
        json={"source": "announcement", "source_ids": [ann_id]},
        headers=hdrs,
    )
    assert r2.status_code == 200
    assert r2.json()["marked"] == 1

    # Nachher: gelesen
    r3 = await client.get("/api/notifications?tab=announcements", headers=hdrs)
    items_after = [i for i in r3.json() if i["source_id"] == ann_id]
    assert len(items_after) == 1
    assert items_after[0]["read"] is True
