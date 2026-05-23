# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Tests für Cleanup-Hooks + Action-Handler-Registry."""
from __future__ import annotations

import json
import pytest
import pytest_asyncio

pytestmark = pytest.mark.plus_only

from backend.db.database import init_db
from backend.plus.scheduled_jobs.service import create_job, list_jobs


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    # ensure scheduled_jobs tables exist via Plus-DDL
    from backend.db.database import get_sync_engine
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    eng = get_sync_engine()
    if eng:
        ensure_plus_db_tables(eng)


# ── Action-Handler-Registry ────────────────────────────────────────────────────

def test_get_scheduled_job_action_handlers_returns_dict():
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    handlers = behavior.get_scheduled_job_action_handlers()
    assert isinstance(handlers, dict)


def test_action_handlers_include_all_types():
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    handlers = behavior.get_scheduled_job_action_handlers()
    for expected in ("ssh", "playbook", "power_action", "git_sync"):
        assert expected in handlers, f"Handler '{expected}' fehlt in Registry"


def test_action_handlers_are_callable():
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    handlers = behavior.get_scheduled_job_action_handlers()
    for name, fn in handlers.items():
        assert callable(fn), f"Handler '{name}' ist nicht callable"


# ── on_user_deleted_scheduled_jobs ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_user_deleted_unknown_user_returns_zero():
    """Bei unbekanntem user_id soll der Hook 0 zurückgeben ohne zu crashen."""
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    result = await behavior.on_user_deleted_scheduled_jobs(user_id=99999, actor_username="admin")
    assert result == 0


@pytest.mark.asyncio
async def test_on_playbook_deleted_no_matching_jobs():
    """Bei keinem passenden Job soll der Hook 0 zurückgeben."""
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    result = await behavior.on_playbook_deleted_scheduled_jobs(
        playbook_name="nonexistent_playbook",
        actor_username="admin",
    )
    assert result == 0


@pytest.mark.asyncio
async def test_on_playbook_deleted_deactivates_matching_jobs():
    """Jobs, die das gelöschte Playbook referenzieren, werden deaktiviert."""
    # Job mit passendem Playbook anlegen
    job = await create_job(
        name="Playbook-Test",
        job_type="playbook",
        cron_expression="0 * * * *",
        config={"playbook": "test_playbook.yml"},
        created_by="admin",
    )

    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    result = await behavior.on_playbook_deleted_scheduled_jobs(
        playbook_name="test_playbook.yml",
        actor_username="admin",
    )
    assert result == 1

    # Job muss jetzt inaktiv sein
    jobs = await list_jobs("admin", is_admin=True)
    matching = [j for j in jobs if j["id"] == job["id"]]
    assert matching, "Job nach Deaktivierung nicht mehr in list_jobs"
    assert matching[0]["active"] == 0 or matching[0].get("active") is False


@pytest.mark.asyncio
async def test_on_node_deleted_no_matching_jobs():
    """Bei keinem passenden Node-Job soll der Hook 0 zurückgeben."""
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    result = await behavior.on_node_deleted_scheduled_jobs(
        node_id=99999,
        actor_username="admin",
    )
    assert result == 0


@pytest.mark.asyncio
async def test_on_node_deleted_deletes_power_action_jobs():
    """Power-Action-Jobs für den gelöschten Node werden gelöscht."""
    job = await create_job(
        name="Power-Test",
        job_type="power_action",
        cron_expression="0 3 * * *",
        config={"node": "42", "vmid": "100", "action": "stop"},
        created_by="admin",
    )

    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    behavior = ScheduledJobsPlusBehavior()
    result = await behavior.on_node_deleted_scheduled_jobs(node_id=42, actor_username="admin")
    assert result == 1

    jobs = await list_jobs("admin", is_admin=True)
    matching = [j for j in jobs if j["id"] == job["id"]]
    assert not matching, "Power-Action-Job hätte gelöscht werden sollen"
