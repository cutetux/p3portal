# p3portal.org
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.jobs import router

app = FastAPI()
app.include_router(router)

_TOKEN = create_access_token("testuser@pam")
_ADMIN_TOKEN = create_access_token("admin@pam", role="admin")
_OTHER_TOKEN = create_access_token("otheruser@pam")

_META_YAML = """\
name: "VM erstellen"
description: "Test playbook"
playbook: "pb_vm.yml"
parameters:
  - id: vm_name
    label: "VM Name"
    type: string
    required: true
"""


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest.fixture
def ansible_dir(tmp_path, monkeypatch):
    playbook_dir = tmp_path / "ansible"
    playbook_dir.mkdir()
    (playbook_dir / "meta.yaml").write_text(_META_YAML)
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ansible_dir", str(playbook_dir))
    return str(playbook_dir)


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Auth guard ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_jobs_unauthorized(client: AsyncClient):
    resp = await client.get("/api/jobs")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_post_job_unauthorized(client: AsyncClient):
    resp = await client.post("/api/jobs", json={"playbook": "pb_vm", "params": {}})
    assert resp.status_code in (401, 403)


# ── List / Get ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_jobs_empty(client: AsyncClient):
    resp = await client.get("/api/jobs", headers={"Authorization": f"Bearer {_TOKEN}"})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_job_not_found(client: AsyncClient):
    resp = await client.get("/api/jobs/nonexistent-id", headers={"Authorization": f"Bearer {_TOKEN}"})
    assert resp.status_code == 404


# ── Start job ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_job_invalid_playbook(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ansible_dir", str(tmp_path))  # empty dir → no meta.yaml

    resp = await client.post(
        "/api/jobs",
        json={"playbook": "nonexistent", "params": {}},
        headers={"Authorization": f"Bearer {_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_start_job_missing_required_param(client: AsyncClient, ansible_dir: str):
    with patch("backend.routers.jobs.run_ansible_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/jobs",
            json={"playbook": "pb_vm", "params": {}},  # missing required vm_name
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )
    assert resp.status_code == 422
    errors = resp.json()["detail"]
    assert any("vm_name" in e for e in errors)


@pytest.mark.asyncio
async def test_start_job_success(client: AsyncClient, ansible_dir: str):
    with patch("backend.routers.jobs.run_ansible_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/jobs",
            json={"playbook": "pb_vm", "params": {"vm_name": "test-vm"}},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["playbook"] == "pb_vm"
    assert body["status"] == "pending"
    assert body["username"] == "testuser@pam"
    assert "id" in body

    job_id = body["id"]

    # Job should appear in the list for the owner
    list_resp = await client.get("/api/jobs", headers={"Authorization": f"Bearer {_TOKEN}"})
    assert list_resp.status_code == 200
    assert any(j["id"] == job_id for j in list_resp.json())

    # Job should be fetchable by ID for the owner
    get_resp = await client.get(
        f"/api/jobs/{job_id}", headers={"Authorization": f"Bearer {_TOKEN}"}
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == job_id


# ── Access control ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_non_admin_cannot_see_other_users_job(client: AsyncClient, ansible_dir: str):
    """Job created by testuser should NOT appear in otheruser's list, but should in admin's list."""
    with patch("backend.routers.jobs.run_ansible_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/jobs",
            json={"playbook": "pb_vm", "params": {"vm_name": "test-vm"}},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )
    assert resp.status_code == 201
    job_id = resp.json()["id"]

    # otheruser should not see it
    other_list = await client.get("/api/jobs", headers={"Authorization": f"Bearer {_OTHER_TOKEN}"})
    assert other_list.status_code == 200
    assert not any(j["id"] == job_id for j in other_list.json())

    # admin should see it
    admin_list = await client.get("/api/jobs", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert admin_list.status_code == 200
    assert any(j["id"] == job_id for j in admin_list.json())


@pytest.mark.asyncio
async def test_non_admin_cannot_get_other_users_job_by_id(client: AsyncClient, ansible_dir: str):
    """GET /api/jobs/{id} returns 404 for non-owner non-admin."""
    with patch("backend.routers.jobs.run_ansible_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/jobs",
            json={"playbook": "pb_vm", "params": {"vm_name": "test-vm"}},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )
    job_id = resp.json()["id"]

    # otheruser gets 404
    r = await client.get(f"/api/jobs/{job_id}", headers={"Authorization": f"Bearer {_OTHER_TOKEN}"})
    assert r.status_code == 404

    # admin can access it
    r = await client.get(f"/api/jobs/{job_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200


# ── Pool-Quota-Check (PROJ-62 BUG-62-2 + Security Fix) ────────────────────────

@pytest.mark.asyncio
async def test_start_job_pool_quota_exceeded_returns_structured_412(
    client: AsyncClient, ansible_dir: str
):
    """BUG-62-2: HTTP 412 mit strukturiertem JSON-Detail (error=pool_quota_exceeded)."""
    from backend.core.plus_protocol import QuotaResult

    fake_quota = QuotaResult(
        allowed=False,
        exceeded=["cpu_cores", "ram_mb"],
        current={"vm_count": 3, "cpu_cores": 8, "ram_mb": 12288, "disk_gb": 80},
        requested={"vm_count": 1, "cpu_cores": 4, "ram_mb": 8192, "disk_gb": 50},
        limit={"vm_count": 5, "cpu_cores": 10, "ram_mb": 16384, "disk_gb": 200},
        pool_id=1,
    )

    with (
        patch("backend.routers.jobs.run_ansible_job", new=AsyncMock(return_value=None)),
        patch(
            "backend.core.plus_protocol.plus_behavior.check_pool_quota",
            new=AsyncMock(return_value=fake_quota),
        ),
    ):
        resp = await client.post(
            "/api/jobs",
            json={"playbook": "pb_vm", "params": {"vm_name": "test-vm"}, "pool_id": 1},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )

    assert resp.status_code == 412
    detail = resp.json()["detail"]
    assert detail["error"] == "pool_quota_exceeded"
    assert detail["pool_id"] == 1
    assert "cpu_cores" in detail["exceeded"]
    assert "ram_mb" in detail["exceeded"]
    assert "current" in detail
    assert "requested" in detail
    assert "limit" in detail


@pytest.mark.asyncio
async def test_start_job_pool_quota_check_exception_returns_503(
    client: AsyncClient, ansible_dir: str
):
    """Security Fix: unerwartete Exception im Quota-Check → 503 statt Failsafe-Allow."""
    with (
        patch("backend.routers.jobs.run_ansible_job", new=AsyncMock(return_value=None)),
        patch(
            "backend.core.plus_protocol.plus_behavior.check_pool_quota",
            new=AsyncMock(side_effect=RuntimeError("DB connection lost")),
        ),
    ):
        resp = await client.post(
            "/api/jobs",
            json={"playbook": "pb_vm", "params": {"vm_name": "test-vm"}, "pool_id": 1},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )

    assert resp.status_code == 503
