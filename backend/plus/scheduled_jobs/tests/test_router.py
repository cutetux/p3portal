# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Tests für den /api/scheduled-jobs Router (Plus-Modul)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock

pytestmark = pytest.mark.plus_only

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.plus.scheduled_jobs.router import router, settings_router

app = FastAPI()
app.include_router(router)
app.include_router(settings_router)

_ADMIN_TOKEN   = create_access_token("admin",    auth_type="local", role="admin",    portal_permissions=[])
_OP_TOKEN      = create_access_token("operator", auth_type="local", role="operator", portal_permissions=["manage_scheduled_jobs"])
_VIEWER_TOKEN  = create_access_token("viewer",   auth_type="local", role="viewer",   portal_permissions=[])
_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}
_OP_HEADERS    = {"Authorization": f"Bearer {_OP_TOKEN}"}
_VIEWER_HEADERS = {"Authorization": f"Bearer {_VIEWER_TOKEN}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    from backend.db.database import get_sync_engine
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    eng = get_sync_engine()
    if eng:
        ensure_plus_db_tables(eng)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Unauthenticated ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_unauthenticated(client):
    r = await client.get("/api/scheduled-jobs")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_unauthenticated(client):
    r = await client.post("/api/scheduled-jobs", json={})
    assert r.status_code == 401


# ── Liste leer ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_empty(client):
    r = await client.get("/api/scheduled-jobs", headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_accessible_for_viewer(client):
    """Viewer (und alle auth. Nutzer) können ihre eigenen Jobs auflisten."""
    r = await client.get("/api/scheduled-jobs", headers=_VIEWER_HEADERS)
    assert r.status_code == 200
    assert r.json() == []


# ── Job erstellen ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_ssh_job(client):
    payload = {
        "name": "Test SSH Job",
        "job_type": "ssh",
        "cron_expression": "0 * * * *",
        "config": {"user_host": "root@192.168.1.10", "command": "uptime", "ssh_key_source": "system", "timeout": 30},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Test SSH Job"
    assert data["job_type"] == "ssh"
    assert data["active"] is True
    assert data["cron_expression"] == "0 * * * *"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_playbook_job(client):
    payload = {
        "name": "Weekly Playbook",
        "job_type": "playbook",
        "cron_expression": "0 0 * * 0",
        "config": {"playbook": "deploy_vm", "params": {"vm_name": "web01"}},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    assert r.status_code == 201
    data = r.json()
    assert data["job_type"] == "playbook"


@pytest.mark.asyncio
async def test_create_power_action_job(client):
    payload = {
        "name": "Daily Start",
        "job_type": "power_action",
        "cron_expression": "0 8 * * *",
        "config": {"node": "pve1", "vmid": 101, "vmtype": "qemu", "action": "start"},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    assert r.status_code == 201
    data = r.json()
    assert data["job_type"] == "power_action"


@pytest.mark.asyncio
async def test_create_with_invalid_cron(client):
    payload = {
        "name": "Bad Cron",
        "job_type": "ssh",
        "cron_expression": "not-a-cron",
        "config": {},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_with_invalid_type(client):
    payload = {
        "name": "Bad Type",
        "job_type": "invalid_type",
        "cron_expression": "0 * * * *",
        "config": {},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_operator_can_create(client):
    payload = {
        "name": "Operator Job",
        "job_type": "ssh",
        "cron_expression": "*/15 * * * *",
        "config": {},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_OP_HEADERS)
    assert r.status_code == 201


# ── Detail-Abruf ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_job(client):
    payload = {
        "name": "Get Me",
        "job_type": "ssh",
        "cron_expression": "0 0 * * *",
        "config": {},
    }
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    r = await client.get(f"/api/scheduled-jobs/{job_id}", headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["id"] == job_id


@pytest.mark.asyncio
async def test_get_job_not_found(client):
    r = await client.get("/api/scheduled-jobs/nonexistent-id", headers=_ADMIN_HEADERS)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_job_ownership(client):
    """Operator kann nicht auf Jobs eines anderen Nutzers zugreifen."""
    payload = {"name": "Admin Job", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    r = await client.get(f"/api/scheduled-jobs/{job_id}", headers=_OP_HEADERS)
    assert r.status_code == 403


# ── Aktualisieren ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_job(client):
    payload = {"name": "Old Name", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    r = await client.put(f"/api/scheduled-jobs/{job_id}", json={"name": "New Name"}, headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_update_nonexistent(client):
    r = await client.put("/api/scheduled-jobs/bad-id", json={"name": "X"}, headers=_ADMIN_HEADERS)
    assert r.status_code == 404


# ── Löschen ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_job(client):
    payload = {"name": "Delete Me", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    r = await client.delete(f"/api/scheduled-jobs/{job_id}", headers=_ADMIN_HEADERS)
    assert r.status_code == 204

    r2 = await client.get(f"/api/scheduled-jobs/{job_id}", headers=_ADMIN_HEADERS)
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent(client):
    r = await client.delete("/api/scheduled-jobs/bad-id", headers=_ADMIN_HEADERS)
    assert r.status_code == 404


# ── Toggle ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_toggle_job(client):
    payload = {"name": "Toggle Me", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]
    assert create_r.json()["active"] is True

    r = await client.post(f"/api/scheduled-jobs/{job_id}/toggle", headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["active"] is False

    r2 = await client.post(f"/api/scheduled-jobs/{job_id}/toggle", headers=_ADMIN_HEADERS)
    assert r2.status_code == 200
    assert r2.json()["active"] is True


# ── Manueller Run ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_now(client):
    payload = {"name": "Run Now", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    with patch("backend.plus.scheduled_jobs.celery._execute_task_ref") as mock_task:
        mock_task.delay = MagicMock()
        r = await client.post(f"/api/scheduled-jobs/{job_id}/run", headers=_ADMIN_HEADERS)
    assert r.status_code == 202
    data = r.json()
    assert data["status"] == "queued"
    assert data["job_id"] == job_id


# ── Run-History ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_runs_empty(client):
    payload = {"name": "No Runs", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    r = await client.get(f"/api/scheduled-jobs/{job_id}/runs", headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_runs_with_entries(client):
    from backend.plus.scheduled_jobs.service import create_run, finish_run

    payload = {"name": "With Runs", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    create_r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    job_id = create_r.json()["id"]

    run_id = await create_run(job_id, "manual")
    await finish_run(run_id, job_id, "output text", 0)

    r = await client.get(f"/api/scheduled-jobs/{job_id}/runs", headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) == 1
    assert runs[0]["status"] == "success"
    assert runs[0]["exit_code"] == 0


# ── Admin-Sichtbarkeit ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_sees_all_jobs(client):
    """Admin sieht Jobs aller Nutzer, Operator nur eigene."""
    op_payload = {"name": "Op Job", "job_type": "ssh", "cron_expression": "0 0 * * *", "config": {}}
    await client.post("/api/scheduled-jobs", json=op_payload, headers=_OP_HEADERS)

    admin_list = await client.get("/api/scheduled-jobs", headers=_ADMIN_HEADERS)
    op_list = await client.get("/api/scheduled-jobs", headers=_OP_HEADERS)

    assert len(admin_list.json()) >= 1
    # Operator sieht nur seine eigenen
    for j in op_list.json():
        assert j["created_by"] == "operator"


# ── Admin-Settings ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_settings(client):
    r = await client.get("/api/admin/scheduled-jobs/settings", headers=_ADMIN_HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert "history_limit" in data
    assert "has_system_ssh_key" in data
    assert data["history_limit"] == 20
    assert data["has_system_ssh_key"] is False


@pytest.mark.asyncio
async def test_settings_forbidden_for_operator(client):
    r = await client.get("/api/admin/scheduled-jobs/settings", headers=_OP_HEADERS)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_set_history_limit(client):
    r = await client.put(
        "/api/admin/scheduled-jobs/settings/history-limit",
        json={"limit": 50},
        headers=_ADMIN_HEADERS,
    )
    assert r.status_code == 204

    r2 = await client.get("/api/admin/scheduled-jobs/settings", headers=_ADMIN_HEADERS)
    assert r2.json()["history_limit"] == 50


@pytest.mark.asyncio
async def test_set_history_limit_validation(client):
    r = await client.put(
        "/api/admin/scheduled-jobs/settings/history-limit",
        json={"limit": 0},
        headers=_ADMIN_HEADERS,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_system_ssh_key(client):
    r = await client.put(
        "/api/admin/scheduled-jobs/settings/system-ssh-key",
        json={"key": "-----BEGIN RSA PRIVATE KEY-----\nMockKey\n-----END RSA PRIVATE KEY-----"},
        headers=_ADMIN_HEADERS,
    )
    assert r.status_code == 204

    r2 = await client.get("/api/admin/scheduled-jobs/settings", headers=_ADMIN_HEADERS)
    assert r2.json()["has_system_ssh_key"] is True


@pytest.mark.asyncio
async def test_delete_system_ssh_key(client):
    # Erst setzen
    await client.put(
        "/api/admin/scheduled-jobs/settings/system-ssh-key",
        json={"key": "some-key"},
        headers=_ADMIN_HEADERS,
    )
    # Dann löschen
    r = await client.delete("/api/admin/scheduled-jobs/settings/system-ssh-key", headers=_ADMIN_HEADERS)
    assert r.status_code == 204

    r2 = await client.get("/api/admin/scheduled-jobs/settings", headers=_ADMIN_HEADERS)
    assert r2.json()["has_system_ssh_key"] is False


# ── Zeitfenster-Modus ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_window_mode_job(client):
    """Power-Action Job mit Zeitfenster-Modus (Start + Stop)."""
    payload = {
        "name": "VM Window",
        "job_type": "power_action",
        "cron_expression": "0 8 * * *",
        "config": {"node": "pve1", "vmid": 101, "vmtype": "qemu", "action": "start"},
        "window_mode": True,
        "window_stop_cron": "0 20 * * *",
        "window_stop_config": {"node": "pve1", "vmid": 101, "vmtype": "qemu", "action": "stop"},
    }
    r = await client.post("/api/scheduled-jobs", json=payload, headers=_ADMIN_HEADERS)
    assert r.status_code == 201
    data = r.json()
    assert data["child_job"] is not None
    assert data["child_job"]["cron_expression"] == "0 20 * * *"
    assert data["child_job"]["config"]["action"] == "stop"
