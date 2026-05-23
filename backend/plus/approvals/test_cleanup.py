# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Tests für cleanup.py (Delete-Hooks)."""
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
from backend.plus.approvals import cleanup, rules_service


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db_ready():
    await init_db()
    from backend.plus.approvals.models import plus_metadata
    from backend.db.database import _engine  # noqa: PLC2701
    async with _engine.begin() as conn:
        await conn.run_sync(plus_metadata.create_all)
    yield


async def _seed_user(username: str = "user1") -> int:
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


async def _seed_approval(requester_id: int, action_type: str = "playbook_run", action_target: str = "pb") -> str:
    from backend.plus.approvals.service import _generate_id
    approval_id = _generate_id()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            text("""
                INSERT INTO pending_approvals
                    (id, action_type, action_target, payload, payload_hash,
                     requester_user_id, requested_at, expires_at, status, rule_snapshot)
                VALUES (:id, :at, :tgt, '{}', 'hash', :uid, :now, :exp, 'pending', '{}')
            """),
            {"id": approval_id, "at": action_type, "tgt": action_target,
             "uid": requester_id, "now": now, "exp": "2099-01-01T00:00:00"},
        )
        await db.commit()
    return approval_id


# ── on_user_delete ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_user_delete_cancels_pending(db_ready):
    uid = await _seed_user()
    approval_id = await _seed_approval(uid)

    await cleanup.on_user_delete(uid, "admin")

    async with get_db() as db:
        result = await db.execute(
            text("SELECT status FROM pending_approvals WHERE id=:id"),
            {"id": approval_id},
        )
        row = result.fetchone()
    assert row[0] == "cancelled"


# ── on_playbook_delete ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_playbook_delete_cancels_pending(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    uid = await _seed_user()
    approval_id = await _seed_approval(uid, action_type="playbook_run", action_target="my_playbook")

    # Regel anlegen
    await rules_service.create_rule(
        action_type="playbook_run", action_target="my_playbook",
        required=True, approver_groups=[], approver_users=[],
        expiration_hours=48, allow_self_approval=False,
        source="meta_yaml", actor_user_id=None, actor_username="system",
    )

    await cleanup.on_playbook_delete("my_playbook", "admin")

    async with get_db() as db:
        # Antrag gecancelt
        result = await db.execute(
            text("SELECT status FROM pending_approvals WHERE id=:id"),
            {"id": approval_id},
        )
        row = result.fetchone()
        assert row[0] == "cancelled"

        # Regel gelöscht
        result2 = await db.execute(
            text("SELECT COUNT(*) FROM approval_rules WHERE action_target='my_playbook'")
        )
        assert result2.scalar() == 0


# ── on_group_delete ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_group_delete_deactivates_empty_rule(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text("INSERT INTO groups (name, description, created_at, created_by) VALUES ('g1', '', :now, 'admin') RETURNING id"),
            {"now": now},
        )
        gid = result.fetchone()[0]
        await db.commit()

    # Regel mit dieser Gruppe anlegen
    rule = await rules_service.create_rule(
        action_type="playbook_run", action_target="group_pb",
        required=True, approver_groups=[gid], approver_users=[],
        expiration_hours=48, allow_self_approval=False,
        source="ui_override", actor_user_id=None, actor_username="admin",
    )

    # Kein default_approver_group_id → Regel wird deaktiviert
    # config_service.get_config gibt None zurück (kein Eintrag in DB)

    await cleanup.on_group_delete(gid, "admin")

    async with get_db() as db:
        result = await db.execute(
            text("SELECT is_active FROM approval_rules WHERE id=:id"),
            {"id": rule["id"]},
        )
        row = result.fetchone()
    assert row[0] == 0
