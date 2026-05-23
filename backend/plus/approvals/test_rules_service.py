# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Tests für rules_service.py."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text

pytestmark = pytest.mark.plus_only

from backend.core.config import settings
from backend.core.plus_protocol import plus_behavior
from backend.db.database import get_db, init_db
from backend.plus.approvals import rules_service


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


async def _create_rule(
    action_type="playbook_run",
    action_target="test_playbook",
    required=True,
    source="ui_override",
) -> dict:
    return await rules_service.create_rule(
        action_type=action_type,
        action_target=action_target,
        required=required,
        approver_groups=[],
        approver_users=[],
        expiration_hours=48,
        allow_self_approval=False,
        source=source,
        actor_user_id=None,
        actor_username="admin",
    )


# ── is_approval_workflow_enabled ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_workflow_disabled_by_default(db_ready):
    enabled = await rules_service.is_approval_workflow_enabled()
    assert enabled is False


# ── create_rule ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_rule_happy_path(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    rule = await _create_rule()
    assert rule["action_type"] == "playbook_run"
    assert rule["action_target"] == "test_playbook"
    assert rule["required"] == 1
    assert rule["source"] == "ui_override"


@pytest.mark.asyncio
async def test_create_rule_invalid_action_type(db_ready):
    with pytest.raises(ValueError, match="Ungültiger action_type"):
        await rules_service.create_rule(
            action_type="invalid_action",
            action_target="something",
            required=True,
            approver_groups=[],
            approver_users=[],
            expiration_hours=48,
            allow_self_approval=False,
            source="ui_override",
            actor_user_id=None,
            actor_username="admin",
        )


@pytest.mark.asyncio
async def test_create_rule_core_limit(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: 3)
    # Erstelle 3 Regeln
    for i in range(3):
        await _create_rule(action_target=f"playbook_{i}")

    # 4. Regel soll fehlschlagen
    with pytest.raises(ValueError, match="core_limit_3_approval_rules"):
        await _create_rule(action_target="playbook_x")


@pytest.mark.asyncio
async def test_create_rule_duplicate(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _create_rule()
    with pytest.raises(ValueError, match="already_exists"):
        await _create_rule()


# ── get_rule_for_action ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_rule_for_action_missing(db_ready):
    result = await rules_service.get_rule_for_action("playbook_run", "nonexistent")
    assert result is None


@pytest.mark.asyncio
async def test_get_rule_for_action_found(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    await _create_rule()
    result = await rules_service.get_rule_for_action("playbook_run", "test_playbook")
    assert result is not None
    assert result["action_type"] == "playbook_run"


# ── update_rule ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_rule(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    monkeypatch.setattr(plus_behavior, "allow_self_approval_supported", lambda: True)
    rule = await _create_rule()
    updated = await rules_service.update_rule(
        rule_id=rule["id"],
        updates={"expiration_hours": 24},
        actor_user_id=None,
        actor_username="admin",
    )
    assert updated["expiration_hours"] == 24


# ── delete_rule ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_meta_yaml_rule_forbidden(db_ready, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_approval_rules", lambda: None)
    rule = await rules_service.create_rule(
        action_type="playbook_run",
        action_target="meta_pb",
        required=True,
        approver_groups=[],
        approver_users=[],
        expiration_hours=48,
        allow_self_approval=False,
        source="meta_yaml",
        actor_user_id=None,
        actor_username="system",
    )
    with pytest.raises(ValueError, match="cannot_delete_meta_yaml_rule"):
        await rules_service.delete_rule(rule["id"], None, "admin")


# ── sync_meta_yaml_rule ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sync_meta_yaml_creates_new_rule(db_ready):
    await rules_service.sync_meta_yaml_rule(
        "playbook_run", "auto_pb",
        {"required": True, "expiration_hours": 24},
    )
    rule = await rules_service.get_rule_for_action("playbook_run", "auto_pb")
    assert rule is not None
    assert rule["source"] == "meta_yaml"
    assert rule["required"] == 1
