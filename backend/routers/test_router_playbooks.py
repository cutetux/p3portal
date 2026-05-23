# p3portal.org
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.routers.playbooks import router

app = FastAPI()
app.include_router(router)

_TOKEN = create_access_token("testuser@pam")

_META_YAML = """\
name: "Test Playbook"
description: "A test playbook for unit tests"
playbook: "pb_test.yml"
required_role: null
parameters:
  - id: vm_name
    label: "VM Name"
    type: string
    required: true
  - id: vm_count
    label: "Count"
    type: integer
    required: false
    min: 1
    max: 10
    default: 1
  - id: os
    label: "OS"
    type: dropdown
    required: false
    options:
      - label: "Ubuntu"
        value: "ubuntu"
      - label: "Debian"
        value: "debian"
"""


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def ansible_dir(tmp_path):
    (tmp_path / "meta.yaml").write_text(_META_YAML)
    return str(tmp_path)


# ── Auth guard ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_playbooks_unauthorized(client: AsyncClient):
    resp = await client.get("/api/playbooks")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_playbook_detail_unauthorized(client: AsyncClient):
    resp = await client.get("/api/playbooks/pb_test")
    assert resp.status_code in (401, 403)


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_playbooks_success(client: AsyncClient, ansible_dir: str, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ansible_dir", ansible_dir)

    resp = await client.get("/api/playbooks", headers={"Authorization": f"Bearer {_TOKEN}"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == "pb_test"
    assert body[0]["name"] == "Test Playbook"
    assert body[0]["required_role"] is None


@pytest.mark.asyncio
async def test_list_playbooks_empty_dir(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ansible_dir", str(tmp_path))

    resp = await client.get("/api/playbooks", headers={"Authorization": f"Bearer {_TOKEN}"})
    assert resp.status_code == 200
    assert resp.json() == []


# ── Detail ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_playbook_detail_success(client: AsyncClient, ansible_dir: str, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ansible_dir", ansible_dir)

    resp = await client.get("/api/playbooks/pb_test", headers={"Authorization": f"Bearer {_TOKEN}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "pb_test"
    assert len(body["parameters"]) == 3
    # Verify parameter types are present
    types = {p["id"]: p["type"] for p in body["parameters"]}
    assert types["vm_name"] == "string"
    assert types["vm_count"] == "integer"
    assert types["os"] == "dropdown"


@pytest.mark.asyncio
async def test_get_playbook_detail_not_found(client: AsyncClient, ansible_dir: str, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ansible_dir", ansible_dir)

    resp = await client.get(
        "/api/playbooks/nonexistent",
        headers={"Authorization": f"Bearer {_TOKEN}"},
    )
    assert resp.status_code == 404
