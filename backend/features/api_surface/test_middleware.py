# p3portal.org
"""Tests für PROJ-44: UpkRateLimitMiddleware."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from backend.features.api_surface.middleware import UpkRateLimitMiddleware


def _make_app(rate_per_min: int = 600) -> FastAPI:
    app = FastAPI()
    app.add_middleware(UpkRateLimitMiddleware, rate_per_min=rate_per_min)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


# ── JWT-Anfragen werden nicht rate-gelimt ────────────────────────────────────

@pytest.mark.asyncio
async def test_jwt_not_rate_limited():
    app = _make_app(rate_per_min=1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Mehr als 1 Request pro Minute mit JWT – kein 429
        for _ in range(5):
            resp = await ac.get("/ping", headers={"Authorization": "Bearer some.jwt.token"})
            assert resp.status_code == 200


@pytest.mark.asyncio
async def test_no_auth_not_rate_limited():
    app = _make_app(rate_per_min=1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        for _ in range(3):
            resp = await ac.get("/ping")
            assert resp.status_code == 200


# ── upk_-Anfragen werden rate-gelimt ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_upk_rate_limit_exceeded():
    """Nach rate_per_min Anfragen → 429 mit Retry-After."""
    app = _make_app(rate_per_min=3)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Wir mocken die Bucket-Logik: auth-Header beginnt mit 'Bearer upk_'
        # Da wir keinen echten Key haben, muss die Middleware auf Header-Präfix prüfen
        headers = {"Authorization": "Bearer upk_testkey123"}
        for i in range(3):
            resp = await ac.get("/ping", headers=headers)
            # Die ersten 3 kommen durch (Limit ist 3)
            assert resp.status_code == 200, f"Request {i+1} sollte nicht geblockt werden"

        # Der 4. überschreitet das Limit
        resp = await ac.get("/ping", headers=headers)
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers


@pytest.mark.asyncio
async def test_different_upk_keys_have_separate_buckets():
    """Zwei verschiedene upk_-Keys haben unabhängige Rate-Limit-Buckets."""
    app = _make_app(rate_per_min=2)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        key1 = "Bearer upk_key1"
        key2 = "Bearer upk_key2"

        # Key1: 2 Requests (Limit ausschöpfen)
        for _ in range(2):
            resp = await ac.get("/ping", headers={"Authorization": key1})
            assert resp.status_code == 200

        # Key2: noch frei
        resp = await ac.get("/ping", headers={"Authorization": key2})
        assert resp.status_code == 200

        # Key1: überschritten
        resp = await ac.get("/ping", headers={"Authorization": key1})
        assert resp.status_code == 429
