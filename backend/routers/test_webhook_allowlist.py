# p3portal.org
"""Tests für PROJ-67 Phase 1 – F-002: Webhook-Allowlist API."""
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock


ADMIN_USER = MagicMock(username="admin", auth_type="local", role="admin", jti="jti1")


def _mock_admin(app):
    from backend.core.deps import require_admin_or, get_current_user
    app.dependency_overrides[require_admin_or("manage_settings")] = lambda: ADMIN_USER
    app.dependency_overrides[get_current_user] = lambda: ADMIN_USER


@pytest.fixture
def _mock_db_empty(monkeypatch):
    mock_result = MagicMock()
    mock_result.mappings.return_value.fetchall.return_value = []
    mock_result.fetchall.return_value = []

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()
    mock_db.__aenter__ = AsyncMock(return_value=mock_db)
    mock_db.__aexit__ = AsyncMock(return_value=False)

    monkeypatch.setattr("backend.routers.webhook_allowlist.get_db", lambda: mock_db)
    return mock_db, mock_result


class TestWebhookAllowlistRouter:
    @pytest.mark.asyncio
    async def test_list_empty_returns_empty_list(self, _mock_db_empty, monkeypatch):
        mock_db, mock_result = _mock_db_empty
        mock_result.mappings.return_value.fetchall.return_value = []

        from backend.main import app
        _mock_admin(app)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/webhook-allowlist")
        assert resp.status_code == 200
        assert resp.json() == []
        app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_entry(self, _mock_db_empty, monkeypatch):
        mock_db, mock_result = _mock_db_empty
        mock_result.lastrowid = 1

        with patch("backend.routers.webhook_allowlist.write_audit_log", new_callable=AsyncMock):
            from backend.main import app
            _mock_admin(app)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/webhook-allowlist",
                    json={"pattern": "hooks.example.com", "allow_http": False},
                )
        assert resp.status_code == 201
        data = resp.json()
        assert data["pattern"] == "hooks.example.com"
        app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_entry_normalizes_to_lowercase(self, _mock_db_empty, monkeypatch):
        mock_db, mock_result = _mock_db_empty
        mock_result.lastrowid = 2

        with patch("backend.routers.webhook_allowlist.write_audit_log", new_callable=AsyncMock):
            from backend.main import app
            _mock_admin(app)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/webhook-allowlist",
                    json={"pattern": "HOOKS.EXAMPLE.COM"},
                )
        assert resp.status_code == 201
        assert resp.json()["pattern"] == "hooks.example.com"
        app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_empty_pattern_rejected(self, _mock_db_empty):
        from backend.main import app
        _mock_admin(app)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post(
                "/api/webhook-allowlist",
                json={"pattern": ""},
            )
        assert resp.status_code == 422
        app.dependency_overrides.clear()
