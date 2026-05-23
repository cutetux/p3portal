# p3portal.org
"""PROJ-XX: pytest-Tests für den FEATURE-Router.

Muster analog zu backend/routers/test_router_announcements.py:
- Minimale FastAPI-App mit nur diesem Router
- AsyncClient via httpx.ASGITransport
- Reale JWTs via create_access_token (kein Mock erforderlich)
- Happy path, Validation errors, Auth-Checks
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.features._template.router import router

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_list_features_unauthenticated(client):
    """Unauthenticated request returns 401."""
    response = await client.get("/api/features")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_features_authenticated(client):
    """Authenticated user gets an empty list (no DB needed for template)."""
    response = await client.get(
        "/api/features",
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert response.status_code == 200
    assert response.json() == []
