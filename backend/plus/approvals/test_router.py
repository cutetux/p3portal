# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Router-Tests für den Approval-Workflow."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text

pytestmark = pytest.mark.plus_only

from backend.core.config import settings
from backend.core.plus_protocol import plus_behavior
from backend.core.security import create_access_token
from backend.db.database import get_db, init_db
from backend.plus.approvals import secret_masking
from backend.plus.approvals.router import router

app = FastAPI()
app.include_router(router)

_ADMIN_TOKEN = create_access_token(
    "admin", auth_type="local", role="admin",
    portal_permissions=["manage_users"],
)
_OPERATOR_TOKEN = create_access_token("op_user", role="operator")


@pytest.fixture(autouse=True)
def patch_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    monkeypatch.setenv("SECRET_KEY", "test-key-for-router-tests-1234567")
    secret_masking.reset_fernet_cache()


@pytest_asyncio.fixture
async def client():
    await init_db()
    from backend.plus.approvals.models import plus_metadata
    from backend.db.database import _engine, get_sync_engine  # noqa: PLC2701
    # PROJ-70: scheduled_jobs-Tabellen VOR approval-Tabellen anlegen (FK-Reihenfolge)
    sync_engine = get_sync_engine()
    if sync_engine:
        from backend.plus.scheduled_jobs import ensure_plus_db_tables as _sj_ddl
        _sj_ddl(sync_engine)
    async with _engine.begin() as conn:
        await conn.run_sync(plus_metadata.create_all)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _seed_user(username: str = "admin", role: str = "admin", permissions: list | None = None) -> int:
    pw_hash = hashlib.sha256(b"pw").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    pp = json.dumps(permissions or (["manage_users"] if role == "admin" else []))
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, "
                "portal_permissions) VALUES (:u, :pw, :role, 1, :now, :pp) RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "role": role, "now": now, "pp": pp},
        )
        uid = result.fetchone()[0]
        await db.commit()
    return uid


# ── GET /api/admin/approval-workflow ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_workflow_config_default_disabled(client):
    resp = await client.get(
        "/api/admin/approval-workflow",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is False


# ── POST /api/admin/approval-workflow ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_toggle_workflow_enable_disable(client):
    headers = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}

    # Einschalten
    resp = await client.post(
        "/api/admin/approval-workflow",
        json={"enabled": True},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True

    # Wieder ausschalten
    resp = await client.post(
        "/api/admin/approval-workflow",
        json={"enabled": False},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


# ── GET /api/approval-rules ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_rules_empty(client):
    resp = await client.get(
        "/api/approval-rules",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ── POST /api/approval-rules ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_rule(client, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    resp = await client.post(
        "/api/approval-rules",
        json={
            "action_type": "playbook_run",
            "action_target": "test_pb",
            "required": True,
            "approver_groups": [],
            "approver_users": [],
            "expiration_hours": 48,
            "allow_self_approval": False,
        },
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["action_type"] == "playbook_run"
    assert data["source"] == "ui_override"


# ── GET /api/approvals ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_approvals_empty(client):
    resp = await client.get(
        "/api/approvals",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


# ── GET /api/approvals/count ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_approval_count_zero(client):
    resp = await client.get(
        "/api/approvals/count",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


# ── Nicht-Admin darf keine Regeln verwalten ───────────────────────────────────

@pytest.mark.asyncio
async def test_create_rule_forbidden_for_operator(client):
    resp = await client.post(
        "/api/approval-rules",
        json={
            "action_type": "playbook_run",
            "action_target": "x",
            "required": True,
            "approver_groups": [],
            "approver_users": [],
            "expiration_hours": 48,
            "allow_self_approval": False,
        },
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 403


# ── 404 für nicht existierenden Antrag ───────────────────────────────────────

@pytest.mark.asyncio
async def test_get_nonexistent_approval(client):
    resp = await client.get(
        "/api/approvals/appr_doesnotexist1234567890",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


# ── Core-Limit bei Regel-Erstellung ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_rule_core_limit_rejected(client, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: 0)
    resp = await client.post(
        "/api/approval-rules",
        json={
            "action_type": "playbook_run",
            "action_target": "limit_test",
            "required": True,
            "approver_groups": [],
            "approver_users": [],
            "expiration_hours": 48,
            "allow_self_approval": False,
        },
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 402
