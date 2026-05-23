# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Tests für permissions.py (can_user_approve 5-Stufen-Routing)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text

pytestmark = pytest.mark.plus_only

from backend.core.config import settings
from backend.db.database import get_db, init_db
from backend.plus.approvals.permissions import can_user_approve


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


# ── Stufe 1: Admin-Override ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_always_can_approve(db_ready):
    uid = await _seed_user()
    result = await can_user_approve(uid, ["manage_users"], {})
    assert result is True


# ── Stufe 2: approver_users ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_user_in_approver_users(db_ready):
    uid = await _seed_user()
    snapshot = {"approver_users": [uid]}
    result = await can_user_approve(uid, [], snapshot)
    assert result is True


@pytest.mark.asyncio
async def test_user_not_in_approver_users(db_ready):
    uid = await _seed_user()
    snapshot = {"approver_users": [999]}
    result = await can_user_approve(uid, [], snapshot)
    assert result is False


# ── Stufe 3: approver_groups ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_user_in_approver_group(db_ready):
    uid = await _seed_user()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text("INSERT INTO groups (name, description, created_at, created_by) VALUES ('approvers', '', :now, 'admin') RETURNING id"),
            {"now": now},
        )
        gid = result.fetchone()[0]
        await db.execute(
            text("INSERT INTO group_members (group_id, user_id, added_at, added_by) VALUES (:gid, :uid, :now, 'admin')"),
            {"gid": gid, "uid": uid, "now": now},
        )
        await db.commit()

    snapshot = {"approver_groups": [gid]}
    result = await can_user_approve(uid, [], snapshot)
    assert result is True


# ── Stufe 5: approve_jobs-Permission ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_approve_jobs_permission(db_ready):
    # Kein default_approver_group_id in DB → Stufe 4 gibt None → Stufe 5 greift
    uid = await _seed_user()
    result = await can_user_approve(uid, ["approve_jobs"], {})
    assert result is True


@pytest.mark.asyncio
async def test_no_permission_returns_false(db_ready):
    # Kein default_approver_group_id in DB, keine Permissions → false
    uid = await _seed_user()
    result = await can_user_approve(uid, [], {})
    assert result is False
