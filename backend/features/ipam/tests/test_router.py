# p3portal.org
"""PROJ-42 Phase 1 – Router-Tests: Pool-CRUD (RBAC), by-network, suggest."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.ipam import router as ipam_router_module
from backend.features.ipam.router import router

app = FastAPI()
app.include_router(router)

_ADMIN = {"Authorization": f"Bearer {create_access_token('admin', auth_type='local', role='admin')}"}
_OPERATOR = {"Authorization": f"Bearer {create_access_token('op', auth_type='local', role='operator')}"}
_RESTRICTED = {"Authorization": f"Bearer {create_access_token('r', auth_type='local', role='restricted')}"}

_POOL = {
    "kind": "bridge", "network_name": "vmbr0", "node": "pve",
    "cidr": "192.168.2.0/24", "gateway": "192.168.2.1",
}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Auth / RBAC ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_unauthenticated(client):
    assert (await client.get("/api/ipam/pools")).status_code == 401


@pytest.mark.asyncio
async def test_pool_crud_forbidden_for_operator(client):
    # Core: Pool-Verwaltung = Admin-only (Operator hat kein manage_ipam)
    assert (await client.get("/api/ipam/pools", headers=_OPERATOR)).status_code == 403
    assert (await client.post("/api/ipam/pools", json=_POOL, headers=_OPERATOR)).status_code == 403


# ── Pool-CRUD ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_get_pool(client):
    r = await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)
    assert r.status_code == 201, r.text
    pool = r.json()
    assert pool["network_name"] == "vmbr0" and pool["node"] == "pve"
    assert pool["vlan_tag"] is None
    pid = pool["id"]
    got = await client.get(f"/api/ipam/pools/{pid}", headers=_ADMIN)
    assert got.status_code == 200 and got.json()["cidr"] == "192.168.2.0/24"


@pytest.mark.asyncio
async def test_duplicate_subnet_conflicts(client):
    assert (await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)).status_code == 201
    dup = await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_multiple_subnets_same_bridge_allowed(client):
    assert (await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)).status_code == 201
    second = dict(_POOL, cidr="10.0.0.0/24", gateway="10.0.0.1")
    assert (await client.post("/api/ipam/pools", json=second, headers=_ADMIN)).status_code == 201


@pytest.mark.asyncio
async def test_vlan_distinguishes_pools(client):
    a = dict(_POOL, vlan_tag=10, cidr="192.168.10.0/24", gateway="192.168.10.1")
    b = dict(_POOL, vlan_tag=20, cidr="192.168.20.0/24", gateway="192.168.20.1")
    assert (await client.post("/api/ipam/pools", json=a, headers=_ADMIN)).status_code == 201
    assert (await client.post("/api/ipam/pools", json=b, headers=_ADMIN)).status_code == 201


@pytest.mark.asyncio
async def test_update_and_delete_pool(client):
    pid = (await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)).json()["id"]
    upd = dict(_POOL, description="prod")
    r = await client.put(f"/api/ipam/pools/{pid}", json=upd, headers=_ADMIN)
    assert r.status_code == 200 and r.json()["description"] == "prod"
    assert (await client.delete(f"/api/ipam/pools/{pid}", headers=_ADMIN)).status_code == 204
    assert (await client.get(f"/api/ipam/pools/{pid}", headers=_ADMIN)).status_code == 404


@pytest.mark.asyncio
async def test_update_missing_404(client):
    r = await client.put("/api/ipam/pools/999", json=_POOL, headers=_ADMIN)
    assert r.status_code == 404


# ── Deploy-Auflösung ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_by_network_for_operator(client):
    await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)
    r = await client.get(
        "/api/ipam/pools/by-network",
        params={"kind": "bridge", "network_name": "vmbr0", "node": "pve"},
        headers=_OPERATOR,
    )
    assert r.status_code == 200
    assert len(r.json()) == 1 and r.json()[0]["network_name"] == "vmbr0"


@pytest.mark.asyncio
async def test_by_network_restricted_forbidden(client):
    r = await client.get(
        "/api/ipam/pools/by-network",
        params={"kind": "bridge", "network_name": "vmbr0", "node": "pve"},
        headers=_RESTRICTED,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_available_lists_all_pools_for_operator(client):
    await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)
    r = await client.get("/api/ipam/pools/available", headers=_OPERATOR)
    assert r.status_code == 200
    assert len(r.json()) == 1 and r.json()[0]["network_name"] == "vmbr0"


@pytest.mark.asyncio
async def test_available_restricted_forbidden(client):
    r = await client.get("/api/ipam/pools/available", headers=_RESTRICTED)
    assert r.status_code == 403


# ── Free-IP-Vorschlag (Proxmox-Quelle gemockt) ────────────────────────────────

@pytest.mark.asyncio
async def test_suggest_lowest_free(client, monkeypatch):
    pid = (await client.post("/api/ipam/pools", json=_POOL, headers=_ADMIN)).json()["id"]

    async def _fake_used(user, force=False):
        return {"192.168.2.2", "192.168.2.3", "10.0.0.9"}  # .9 außerhalb → ignoriert
    monkeypatch.setattr(ipam_router_module, "collect_used_ipv4s", _fake_used)

    r = await client.get("/api/ipam/suggest", params={"pool_id": pid}, headers=_OPERATOR)
    assert r.status_code == 200
    body = r.json()
    # .1 = Gateway, .2/.3 belegt → .4
    assert body["ip"] == "192.168.2.4" and body["best_effort"] is True


@pytest.mark.asyncio
async def test_suggest_exhausted(client, monkeypatch):
    small = dict(_POOL, cidr="192.168.9.0/30", gateway="192.168.9.1")
    pid = (await client.post("/api/ipam/pools", json=small, headers=_ADMIN)).json()["id"]

    async def _fake_used(user, force=False):
        return {"192.168.9.2"}
    monkeypatch.setattr(ipam_router_module, "collect_used_ipv4s", _fake_used)

    r = await client.get("/api/ipam/suggest", params={"pool_id": pid}, headers=_OPERATOR)
    assert r.status_code == 200
    assert r.json()["ip"] is None and r.json()["reason"] == "pool_exhausted"


@pytest.mark.asyncio
async def test_suggest_missing_pool_404(client, monkeypatch):
    async def _fake_used(user, force=False):
        return set()
    monkeypatch.setattr(ipam_router_module, "collect_used_ipv4s", _fake_used)
    r = await client.get("/api/ipam/suggest", params={"pool_id": 999}, headers=_OPERATOR)
    assert r.status_code == 404
