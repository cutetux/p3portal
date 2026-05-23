# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: pytest-Tests für die Git-Sync-Router."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.core.plus_protocol import plus_behavior
from backend.plus.git_sync.router import router
from backend.plus.git_sync.webhook_router import webhook_router

pytestmark = pytest.mark.plus_only

app = FastAPI()
app.include_router(router)
app.include_router(webhook_router)

_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_OPERATOR_TOKEN = create_access_token("operator", auth_type="local", role="operator")


@pytest.fixture(autouse=True)
def enable_plus(monkeypatch):
    monkeypatch.setattr(plus_behavior, "can_use_git_sync", lambda: True)


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c


# ── GET /api/git-sync/config/{repo_type} ─────────────────────────────────────

@pytest.mark.asyncio
async def test_get_config_ansible(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "get_config_for_api", AsyncMock(return_value={
        "id": 1, "repo_type": "ansible", "enabled": False,
        "repo_url": "", "branch": "main", "subdir": None,
        "auth_method": "https", "https_username": None,
        "has_https_token": False, "ssh_public_key": None,
        "has_webhook_token": True, "auto_sync_interval": 0,
        "updated_at": None, "updated_by": None,
    }))
    resp = await client.get(
        "/api/git-sync/config/ansible",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json()["repo_type"] == "ansible"


@pytest.mark.asyncio
async def test_get_config_invalid_type(client):
    resp = await client.get(
        "/api/git-sync/config/invalid",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_config_requires_admin(client):
    resp = await client.get(
        "/api/git-sync/config/ansible",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code in (403, 401)


@pytest.mark.asyncio
async def test_get_config_core_blocked(client, monkeypatch):
    monkeypatch.setattr(plus_behavior, "can_use_git_sync", lambda: False)
    resp = await client.get(
        "/api/git-sync/config/ansible",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 412


# ── PUT /api/git-sync/config/{repo_type} ─────────────────────────────────────

@pytest.mark.asyncio
async def test_put_config_ansible(client, monkeypatch):
    from backend.plus.git_sync import service
    expected = {
        "id": 1, "repo_type": "ansible", "enabled": True,
        "repo_url": "https://github.com/org/repo.git", "branch": "main",
        "subdir": None, "auth_method": "https", "https_username": "user",
        "has_https_token": True, "ssh_public_key": None, "has_webhook_token": True,
        "auto_sync_interval": 0, "updated_at": "2026-01-01T00:00:00+00:00",
        "updated_by": "admin",
    }
    monkeypatch.setattr(service, "upsert_config", AsyncMock(return_value=expected))
    with patch("backend.services.audit_service.write_audit_log", new=AsyncMock()):
        resp = await client.put(
            "/api/git-sync/config/ansible",
            json={
                "enabled": True,
                "repo_url": "https://github.com/org/repo.git",
                "branch": "main",
                "auth_method": "https",
                "https_username": "user",
                "https_token": "secret",
            },
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True


@pytest.mark.asyncio
async def test_put_config_invalid_interval(client):
    resp = await client.put(
        "/api/git-sync/config/ansible",
        json={"auto_sync_interval": 99},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_config_invalid_url(client):
    resp = await client.put(
        "/api/git-sync/config/ansible",
        json={"repo_url": "ftp://invalid.host/repo"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


# ── DELETE /api/git-sync/config/{repo_type} ──────────────────────────────────

@pytest.mark.asyncio
async def test_delete_config(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "delete_config", AsyncMock())
    with patch("backend.services.audit_service.write_audit_log", new=AsyncMock()):
        resp = await client.delete(
            "/api/git-sync/config/packer",
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert resp.status_code == 204


# ── GET /api/git-sync/config/{repo_type}/ssh-key ─────────────────────────────

@pytest.mark.asyncio
async def test_get_ssh_key_exists(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "get_ssh_public_key", AsyncMock(return_value="ssh-ed25519 AAAA..."))
    resp = await client.get(
        "/api/git-sync/config/ansible/ssh-key",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert "ssh-ed25519" in resp.json()["public_key"]


@pytest.mark.asyncio
async def test_get_ssh_key_not_found(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "get_ssh_public_key", AsyncMock(return_value=None))
    resp = await client.get(
        "/api/git-sync/config/ansible/ssh-key",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


# ── POST /api/git-sync/config/{repo_type}/regenerate-ssh-key ─────────────────

@pytest.mark.asyncio
async def test_regenerate_ssh_key(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "regenerate_ssh_key", AsyncMock(return_value="ssh-ed25519 BBBB..."))
    resp = await client.post(
        "/api/git-sync/config/ansible/regenerate-ssh-key",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert "ssh-ed25519" in resp.json()["public_key"]


# ── POST /api/git-sync/config/{repo_type}/regenerate-webhook-token ───────────

@pytest.mark.asyncio
async def test_regenerate_webhook_token(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "regenerate_webhook_token", AsyncMock(return_value="newtoken123"))
    resp = await client.post(
        "/api/git-sync/config/ansible/regenerate-webhook-token",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "newtoken123" in data["webhook_url_template"]
    assert data["repo_type"] == "ansible"


# ── POST /api/git-sync/sync/{repo_type} ──────────────────────────────────────

@pytest.mark.asyncio
async def test_trigger_sync_started(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "trigger_sync", AsyncMock(return_value="started"))
    resp = await client.post(
        "/api/git-sync/sync/ansible",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "started"


@pytest.mark.asyncio
async def test_trigger_sync_queued(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "trigger_sync", AsyncMock(return_value="queued"))
    resp = await client.post(
        "/api/git-sync/sync/packer",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"


# ── GET /api/git-sync/logs/{repo_type} ───────────────────────────────────────

@pytest.mark.asyncio
async def test_list_logs(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "list_sync_logs", AsyncMock(return_value=[
        {
            "id": 1, "repo_type": "ansible", "triggered_by": "manual",
            "started_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T00:00:05+00:00",
            "status": "success", "items_synced": 3, "items_conflicted": 0,
            "message": None, "log_detail": None,
        }
    ]))
    resp = await client.get(
        "/api/git-sync/logs/ansible",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["items_synced"] == 3


# ── GET /api/git-sync/conflicts ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_conflicts(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "list_conflicts", AsyncMock(return_value=[
        {
            "id": 1, "repo_type": "ansible", "item_id": "vm_deploy",
            "git_hash": "abc123", "detected_at": "2026-01-01T00:00:00+00:00",
            "resolved_at": None, "resolution": None, "resolved_by": None,
        }
    ]))
    resp = await client.get(
        "/api/git-sync/conflicts",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json()[0]["item_id"] == "vm_deploy"


# ── POST /api/git-sync/conflicts/{id}/resolve ────────────────────────────────

@pytest.mark.asyncio
async def test_resolve_conflict_git(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "resolve_conflict", AsyncMock(return_value=True))
    with patch("backend.services.audit_service.write_audit_log", new=AsyncMock()):
        resp = await client.post(
            "/api/git-sync/conflicts/1/resolve",
            json={"resolution": "git"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert resp.status_code == 200
    assert resp.json()["resolution"] == "git"


@pytest.mark.asyncio
async def test_resolve_conflict_not_found(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "resolve_conflict", AsyncMock(return_value=False))
    with patch("backend.services.audit_service.write_audit_log", new=AsyncMock()):
        resp = await client.post(
            "/api/git-sync/conflicts/999/resolve",
            json={"resolution": "local"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_resolve_conflict_invalid_resolution(client):
    resp = await client.post(
        "/api/git-sync/conflicts/1/resolve",
        json={"resolution": "invalid"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


# ── Webhook-Router ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_webhook_trigger_valid_token(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "verify_webhook_token", AsyncMock(return_value=True))
    monkeypatch.setattr(service, "trigger_sync", AsyncMock(return_value="started"))
    resp = await client.post("/api/git-sync/webhook/ansible/validtoken123")
    assert resp.status_code == 202
    assert resp.json()["repo_type"] == "ansible"


@pytest.mark.asyncio
async def test_webhook_trigger_invalid_token(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "verify_webhook_token", AsyncMock(return_value=False))
    resp = await client.post("/api/git-sync/webhook/ansible/wrongtoken")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_trigger_invalid_repo_type(client, monkeypatch):
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "verify_webhook_token", AsyncMock(return_value=True))
    resp = await client.post("/api/git-sync/webhook/invalid_type/sometoken")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_webhook_no_jwt_required(client, monkeypatch):
    """Webhook-Endpoint erfordert kein JWT."""
    from backend.plus.git_sync import service
    monkeypatch.setattr(service, "verify_webhook_token", AsyncMock(return_value=True))
    monkeypatch.setattr(service, "trigger_sync", AsyncMock(return_value="queued"))
    # Kein Authorization-Header
    resp = await client.post("/api/git-sync/webhook/packer/sometoken")
    assert resp.status_code == 202
