# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Tests für service.py (Approval-Workflow)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text

pytestmark = pytest.mark.plus_only

from backend.core.config import settings
from backend.core.plus_protocol import plus_behavior
from backend.db.database import get_db, init_db
from backend.plus.approvals import rules_service, service, secret_masking


@pytest.fixture(autouse=True)
def patch_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    monkeypatch.setenv("SECRET_KEY", "test-key-for-approvals-service-1234")
    secret_masking.reset_fernet_cache()


@pytest_asyncio.fixture
async def db_ready():
    await init_db()
    from backend.plus.approvals.models import plus_metadata
    from backend.db.database import _engine  # noqa: PLC2701
    async with _engine.begin() as conn:
        await conn.run_sync(plus_metadata.create_all)
    yield


async def _seed_user(username: str = "requester") -> int:
    pw_hash = hashlib.sha256(b"x").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, "
                "portal_permissions) VALUES (:u, :pw, 'operator', 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "now": now},
        )
        uid = result.fetchone()[0]
        await db.commit()
    return uid


async def _enable_workflow():
    async with get_db() as db:
        await db.execute(
            text("""
                INSERT OR IGNORE INTO approval_workflow_config
                    (id, enabled, default_expiration_hours, allow_self_approval_global)
                VALUES (1, 0, 48, 0)
            """)
        )
        await db.execute(text("UPDATE approval_workflow_config SET enabled=1 WHERE id=1"))
        await db.commit()


async def _create_rule(action_target: str = "test_pb") -> dict:
    return await rules_service.create_rule(
        action_type="playbook_run",
        action_target=action_target,
        required=True,
        approver_groups=[],
        approver_users=[],
        expiration_hours=48,
        allow_self_approval=False,
        source="ui_override",
        actor_user_id=None,
        actor_username="admin",
    )


# ── create_approval ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_approval_workflow_disabled(db_ready):
    uid = await _seed_user()
    with pytest.raises(ValueError, match="approval_not_required"):
        await service.create_approval("playbook_run", "test_pb", {}, uid, "requester")


@pytest.mark.asyncio
async def test_create_approval_no_rule(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _enable_workflow()
    uid = await _seed_user()
    with pytest.raises(ValueError, match="approval_not_required"):
        await service.create_approval("playbook_run", "no_rule_pb", {}, uid, "requester")


@pytest.mark.asyncio
async def test_create_approval_happy_path(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _enable_workflow()
    await _create_rule()
    uid = await _seed_user()

    approval = await service.create_approval(
        "playbook_run", "test_pb", {"vm_name": "myvm"}, uid, "requester"
    )
    assert approval["status"] == "pending"
    assert approval["action_type"] == "playbook_run"
    assert approval["id"].startswith("appr_")
    assert approval["payload"]["vm_name"] == "myvm"


# ── reject_approval ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reject_approval(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _enable_workflow()
    await _create_rule()
    uid = await _seed_user()

    approval = await service.create_approval(
        "playbook_run", "test_pb", {"vm_name": "x"}, uid, "requester"
    )
    rejected = await service.reject_approval(
        approval["id"], uid, "admin_user", "zu gefährlich"
    )
    assert rejected["status"] == "rejected"
    assert rejected["payload_secret_blob"] is None


# ── cancel_approval ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_approval(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _enable_workflow()
    await _create_rule()
    uid = await _seed_user()

    approval = await service.create_approval(
        "playbook_run", "test_pb", {}, uid, "requester"
    )
    cancelled = await service.cancel_approval(approval["id"], uid, "requester")
    assert cancelled["status"] == "cancelled"


# ── expire_overdue_approvals ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_expire_overdue(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _enable_workflow()
    await _create_rule()
    uid = await _seed_user()

    approval = await service.create_approval(
        "playbook_run", "test_pb", {}, uid, "requester"
    )
    # Ablaufzeit in die Vergangenheit setzen
    async with get_db() as db:
        await db.execute(
            text("UPDATE pending_approvals SET expires_at='2020-01-01T00:00:00' WHERE id=:id"),
            {"id": approval["id"]},
        )
        await db.commit()

    count = await service.expire_overdue_approvals()
    assert count == 1

    refreshed = await service.get_approval(approval["id"])
    assert refreshed["status"] == "expired"
    assert refreshed["payload_secret_blob"] is None


# ── _generate_id ──────────────────────────────────────────────────────────────

def test_generate_id_format():
    approval_id = service._generate_id()
    assert approval_id.startswith("appr_")
    assert len(approval_id) == 30
