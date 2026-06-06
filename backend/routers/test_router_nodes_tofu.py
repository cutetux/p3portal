# p3portal.org
"""PROJ-76 Phase 2a: 5th per-node token tier (`tofu`).

Covers the Core-schema-additive token columns:
- service round-trip (create/update encrypt → get decrypts)
- secret is stored encrypted, never plaintext
- NodeResponse exposes the token-ID but NEVER the secret
- update preserves the secret when not supplied, replaces it when supplied
- POST/PUT write the `node_tofu_token_set` audit event (AC-2A-TOKEN-7)
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from backend.core.security import create_access_token
from backend.db.database import get_db, init_db
from backend.routers.nodes import router as nodes_router

app = FastAPI()
app.include_router(nodes_router)

_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db(tmp_path):
    await init_db()
    yield


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Service round-trip ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_node_with_tofu_token_roundtrip(db):
    from backend.services.nodes_service import create_node, get_node

    node = await create_node(
        name="Stacks node",
        url="https://pve.example.com:8006",
        proxmox_node="pve",
        verify_ssl=False,
        token_id="user@pam!tok",
        token_secret="s",
        tofu_token_id="portal-tofu@pve!portal-tofu",
        tofu_token_secret="tofu-secret-value",
    )
    assert node.tofu_token_id == "portal-tofu@pve!portal-tofu"
    assert node.tofu_token_secret == "tofu-secret-value"  # decrypted

    fetched = await get_node(node.id)
    assert fetched is not None
    assert fetched.tofu_token_id == "portal-tofu@pve!portal-tofu"
    assert fetched.tofu_token_secret == "tofu-secret-value"


@pytest.mark.asyncio
async def test_tofu_secret_stored_encrypted(db):
    from backend.services.config_service import decrypt_secret
    from backend.services.nodes_service import create_node

    node = await create_node(
        name="n", url="https://pve:8006", proxmox_node="pve", verify_ssl=False,
        token_id="u@pam!t", token_secret="s",
        tofu_token_id="t@pve!t", tofu_token_secret="plain-tofu",
    )
    async with get_db() as session:
        row = (await session.execute(
            text("SELECT tofu_token_secret FROM nodes WHERE id = :id"), {"id": node.id}
        )).mappings().fetchone()
    raw = row["tofu_token_secret"]
    assert raw != "plain-tofu"          # not plaintext
    assert raw != ""                     # something was stored
    assert decrypt_secret(raw) == "plain-tofu"


@pytest.mark.asyncio
async def test_update_preserves_tofu_secret_when_none(db):
    from backend.services.nodes_service import create_node, get_node, update_node

    node = await create_node(
        name="n", url="https://pve:8006", proxmox_node="pve", verify_ssl=False,
        token_id="u@pam!t", token_secret="s",
        tofu_token_id="t@pve!t", tofu_token_secret="keep-me",
    )
    # Update something unrelated; do NOT supply tofu secret
    await update_node(node.id, name="renamed")
    fetched = await get_node(node.id)
    assert fetched.name == "renamed"
    assert fetched.tofu_token_secret == "keep-me"  # preserved


@pytest.mark.asyncio
async def test_update_replaces_tofu_secret_when_given(db):
    from backend.services.nodes_service import create_node, get_node, update_node

    node = await create_node(
        name="n", url="https://pve:8006", proxmox_node="pve", verify_ssl=False,
        token_id="u@pam!t", token_secret="s",
        tofu_token_id="t@pve!t", tofu_token_secret="old",
    )
    await update_node(node.id, tofu_token_id="t@pve!t2", tofu_token_secret="new")
    fetched = await get_node(node.id)
    assert fetched.tofu_token_id == "t@pve!t2"
    assert fetched.tofu_token_secret == "new"


# ── Router: response never leaks the secret ──────────────────────────────────

@pytest.mark.asyncio
async def test_create_response_has_tofu_id_no_secret(client: AsyncClient):
    payload = {
        "name": "n", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t", "token_secret": "s",
        "tofu_token_id": "portal-tofu@pve!portal-tofu",
        "tofu_token_secret": "super-secret-tofu",
    }
    resp = await client.post("/api/admin/nodes", json=payload, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 201
    body = resp.json()
    assert body["tofu_token_id"] == "portal-tofu@pve!portal-tofu"
    # Secret must NEVER appear in any response field
    assert "tofu_token_secret" not in body
    assert "super-secret-tofu" not in resp.text


# ── Router: audit event on set/change (AC-2A-TOKEN-7) ────────────────────────

async def _count_tofu_audit() -> int:
    async with get_db() as session:
        return (await session.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE event_type = 'node_tofu_token_set'")
        )).scalar() or 0


@pytest.mark.asyncio
async def test_audit_written_on_create_with_tofu(client: AsyncClient):
    payload = {
        "name": "n", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t", "token_secret": "s",
        "tofu_token_id": "t@pve!t", "tofu_token_secret": "x",
    }
    resp = await client.post("/api/admin/nodes", json=payload, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 201
    assert await _count_tofu_audit() == 1


@pytest.mark.asyncio
async def test_no_audit_when_no_tofu_token(client: AsyncClient):
    payload = {
        "name": "n", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t", "token_secret": "s",
    }
    resp = await client.post("/api/admin/nodes", json=payload, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 201
    assert await _count_tofu_audit() == 0


# ── BUG-76-2A-1: Audit nur bei tatsächlicher tofu-Token-Änderung ─────────────

async def _create_node_with_tofu(client: AsyncClient) -> int:
    resp = await client.post("/api/admin/nodes", json={
        "name": "n", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t", "token_secret": "s",
        "tofu_token_id": "t@pve!t", "tofu_token_secret": "x",
    }, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_no_audit_on_unrelated_edit_with_existing_tofu(client: AsyncClient):
    """BUG-76-2A-1: pure rename (tofu_token_id resent unchanged, no secret) → no new audit."""
    node_id = await _create_node_with_tofu(client)
    assert await _count_tofu_audit() == 1  # from create

    # Frontend resends the non-secret tofu_token_id but omits the (empty) secret on edit.
    resp = await client.put(f"/api/admin/nodes/{node_id}", json={
        "name": "renamed", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t",
        "tofu_token_id": "t@pve!t",   # unchanged
    }, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"
    assert await _count_tofu_audit() == 1  # NO new audit – token unchanged


@pytest.mark.asyncio
async def test_audit_on_edit_with_new_tofu_secret(client: AsyncClient):
    node_id = await _create_node_with_tofu(client)
    resp = await client.put(f"/api/admin/nodes/{node_id}", json={
        "name": "n", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t",
        "tofu_token_id": "t@pve!t", "tofu_token_secret": "rotated",
    }, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert await _count_tofu_audit() == 2  # create + rotation


@pytest.mark.asyncio
async def test_audit_on_edit_with_changed_tofu_id(client: AsyncClient):
    node_id = await _create_node_with_tofu(client)
    resp = await client.put(f"/api/admin/nodes/{node_id}", json={
        "name": "n", "url": "https://pve.example.com:8006", "proxmox_node": "pve",
        "verify_ssl": False, "token_id": "u@pam!t",
        "tofu_token_id": "t@pve!t2",   # changed id, no new secret
    }, headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert await _count_tofu_audit() == 2  # create + id change
