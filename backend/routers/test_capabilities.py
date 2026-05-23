# p3portal.org
"""PROJ-60/63: Tests für GET /api/capabilities – AC-25 + AC-CAPABILITIES-2.

PROJ-67 Phase 1 – F-017: Endpoint erfordert gültigen JWT.

Testet:
- Anonyme Auth (kein JWT-Header) liefert 401 (F-017)
- Antwort enthält genau die Schlüssel aus CAPABILITIES-Map + extra_portal_permissions
- Core-Antwort: alle bool-Felder False, extra_portal_permissions=[]
- Plus-Antwort (monkeypatch): alle True
- Schema-Stabilität
"""
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.plus_protocol import CAPABILITIES
from backend.core.deps import get_current_user, CurrentUser
from backend.routers.capabilities import router

app = FastAPI()
app.include_router(router)

# Minimal stub that satisfies CurrentUser type-check in tests
_DUMMY_USER = object.__new__(CurrentUser)


@pytest_asyncio.fixture
async def client():
    app.dependency_overrides[get_current_user] = lambda: _DUMMY_USER
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon_client():
    """Client without auth override – tests unauthenticated requests."""
    app.dependency_overrides.clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_capabilities_anonymous_returns_401(anon_client):
    """PROJ-67 F-017: Capabilities-Endpoint erfordert gültigen JWT."""
    resp = await anon_client.get("/api/capabilities")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_capabilities_schema_has_all_keys(client):
    resp = await client.get("/api/capabilities")
    assert resp.status_code == 200
    data = resp.json()
    # CAPABILITIES-Keys müssen alle vorhanden sein + extra_portal_permissions (PROJ-63)
    expected = set(CAPABILITIES.keys()) | {"extra_portal_permissions"}
    assert expected.issubset(set(data.keys()))


@pytest.mark.asyncio
async def test_capabilities_bool_values_are_bool(client):
    resp = await client.get("/api/capabilities")
    data = resp.json()
    for key, value in data.items():
        if key == "extra_portal_permissions":
            assert isinstance(value, list), f"{key} should be list, got {type(value)}"
        else:
            assert isinstance(value, bool), f"{key} should be bool, got {type(value)}"


@pytest.mark.asyncio
async def test_capabilities_extra_portal_permissions_core_is_empty_list(client, monkeypatch):
    """AC-CAPABILITIES-2 (BUG-63-1): extra_portal_permissions ist im Core leer."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.get("/api/capabilities")
    data = resp.json()
    assert "extra_portal_permissions" in data
    assert isinstance(data["extra_portal_permissions"], list)
    assert data["extra_portal_permissions"] == []


@pytest.mark.asyncio
async def test_capabilities_core_bool_all_false(client, monkeypatch):
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.get("/api/capabilities")
    data = resp.json()
    for key, value in data.items():
        if key == "extra_portal_permissions":
            continue
        assert value is False, f"Core: {key} should be False"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_capabilities_plus_all_true(client, monkeypatch):
    """Plus-Antwort: monkeypatch direkt auf plus_behavior-Dispatcher."""
    from backend.core.plus_protocol import CAPABILITIES, plus_behavior
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    for method_name in CAPABILITIES.values():
        monkeypatch.setattr(plus_behavior, method_name, lambda: True)
    resp = await client.get("/api/capabilities")
    data = resp.json()
    for key, value in data.items():
        if key == "extra_portal_permissions":
            assert isinstance(value, list), f"extra_portal_permissions should be list"
        else:
            assert value is True, f"Plus: {key} should be True"


@pytest.mark.asyncio
async def test_capabilities_schema_stable(client):
    """Schlüsselmenge darf sich nicht ändern ohne Spec-Änderung (PROJ-60 + PROJ-63)."""
    resp = await client.get("/api/capabilities")
    data = resp.json()
    expected = set(CAPABILITIES.keys()) | {"extra_portal_permissions"}
    actual = set(data.keys())
    assert actual == expected, f"Unexpected keys: {actual ^ expected}"
