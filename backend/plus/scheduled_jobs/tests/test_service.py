# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Unit-Tests für scheduled_jobs service (Plus-Modul)."""
from __future__ import annotations

import pytest
import pytest_asyncio

pytestmark = pytest.mark.plus_only

from backend.db.database import init_db
from backend.plus.scheduled_jobs.service import (
    advance_next_run,
    create_job,
    create_run,
    delete_job,
    fail_run,
    finish_run,
    get_due_jobs,
    get_job,
    get_runs,
    get_settings,
    list_jobs,
    set_history_limit,
    toggle_job,
    update_job,
)
from backend.models.scheduled_jobs import validate_cron, PRESET_INTERVALS


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    from backend.db.database import get_sync_engine
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    eng = get_sync_engine()
    if eng:
        ensure_plus_db_tables(eng)


# ── Cron-Validierung ──────────────────────────────────────────────────────────

def test_validate_cron_valid():
    assert validate_cron("* * * * *") == "* * * * *"
    assert validate_cron("0 8 * * *") == "0 8 * * *"
    assert validate_cron("*/15 * * * *") == "*/15 * * * *"
    assert validate_cron("0 0 * * 0") == "0 0 * * 0"


def test_validate_cron_invalid():
    with pytest.raises(ValueError):
        validate_cron("not-a-cron")
    with pytest.raises(ValueError):
        validate_cron("0 8 * *")  # nur 4 Felder


def test_preset_intervals():
    assert "15min" in PRESET_INTERVALS
    assert "hourly" in PRESET_INTERVALS
    assert "daily" in PRESET_INTERVALS
    assert "weekly" in PRESET_INTERVALS
    for cron in PRESET_INTERVALS.values():
        validate_cron(cron)  # alle presets müssen valide sein


# ── Job-CRUD ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_get_job():
    job = await create_job(
        name="Test Job",
        job_type="ssh",
        cron_expression="0 * * * *",
        config={"user_host": "root@10.0.0.1", "command": "uptime"},
        created_by="admin",
    )
    assert job["id"]
    assert job["name"] == "Test Job"
    assert job["job_type"] == "ssh"
    assert bool(job["active"]) is True
    assert job["next_run_at"] is not None  # sollte berechnet sein

    fetched = await get_job(job["id"])
    assert fetched is not None
    assert fetched["id"] == job["id"]


@pytest.mark.asyncio
async def test_get_job_not_found():
    result = await get_job("nonexistent-id")
    assert result is None


@pytest.mark.asyncio
async def test_create_inactive_job():
    job = await create_job(
        name="Inactive",
        job_type="ssh",
        cron_expression="0 * * * *",
        config={},
        created_by="admin",
        active=False,
    )
    assert bool(job["active"]) is False
    assert job["next_run_at"] is None


@pytest.mark.asyncio
async def test_list_jobs_admin_sees_all():
    await create_job("Job A", "ssh", "0 * * * *", {}, created_by="user1")
    await create_job("Job B", "ssh", "0 * * * *", {}, created_by="user2")

    all_jobs = await list_jobs("admin", is_admin=True)
    assert len(all_jobs) >= 2


@pytest.mark.asyncio
async def test_list_jobs_user_sees_own():
    await create_job("Own Job", "ssh", "0 * * * *", {}, created_by="user1")
    await create_job("Other Job", "ssh", "0 * * * *", {}, created_by="user2")

    user1_jobs = await list_jobs("user1", is_admin=False)
    for j in user1_jobs:
        assert j["created_by"] == "user1"


@pytest.mark.asyncio
async def test_update_job():
    job = await create_job("Old Name", "ssh", "0 * * * *", {}, created_by="admin")
    updated = await update_job(job["id"], name="New Name", cron_expression="0 8 * * *")
    assert updated["name"] == "New Name"
    assert updated["cron_expression"] == "0 8 * * *"


@pytest.mark.asyncio
async def test_update_nonexistent_job():
    result = await update_job("bad-id", name="X")
    assert result is None


@pytest.mark.asyncio
async def test_delete_job():
    job = await create_job("Delete Me", "ssh", "0 * * * *", {}, created_by="admin")
    deleted = await delete_job(job["id"])
    assert deleted is True

    fetched = await get_job(job["id"])
    assert fetched is None


@pytest.mark.asyncio
async def test_delete_nonexistent():
    result = await delete_job("nonexistent")
    assert result is False


@pytest.mark.asyncio
async def test_toggle_job():
    job = await create_job("Toggle Me", "ssh", "0 * * * *", {}, created_by="admin", active=True)
    assert bool(job["active"]) is True

    toggled = await toggle_job(job["id"])
    assert bool(toggled["active"]) is False  # type: ignore[index]

    toggled2 = await toggle_job(job["id"])
    assert bool(toggled2["active"]) is True  # type: ignore[index]


# ── Dispatcher-Logik ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_due_jobs_empty():
    due = await get_due_jobs()
    assert isinstance(due, list)


@pytest.mark.asyncio
async def test_get_due_jobs_inactive_not_included():
    await create_job("Inactive", "ssh", "* * * * *", {}, created_by="admin", active=False)
    due = await get_due_jobs()
    names = [j["name"] for j in due]
    assert "Inactive" not in names


@pytest.mark.asyncio
async def test_advance_next_run():
    job = await create_job("Advance Test", "ssh", "0 * * * *", {}, created_by="admin")
    old_next = job["next_run_at"]

    await advance_next_run(job["id"], "0 * * * *")

    updated = await get_job(job["id"])
    assert updated["last_run_status"] == "running"  # type: ignore[index]


# ── Run-CRUD ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_finish_run():
    job = await create_job("Run Test", "ssh", "0 * * * *", {}, created_by="admin")
    run_id = await create_run(job["id"], "manual")
    assert run_id

    await finish_run(run_id, job["id"], "output text", 0)

    runs = await get_runs(job["id"])
    assert len(runs) == 1
    assert runs[0]["status"] == "success"
    assert runs[0]["exit_code"] == 0
    assert runs[0]["output"] == "output text"
    assert runs[0]["triggered_by"] == "manual"

    # last_run_status am Job aktualisiert
    updated_job = await get_job(job["id"])
    assert updated_job["last_run_status"] == "success"  # type: ignore[index]


@pytest.mark.asyncio
async def test_fail_run():
    job = await create_job("Fail Test", "ssh", "0 * * * *", {}, created_by="admin")
    run_id = await create_run(job["id"], "scheduler")
    await fail_run(run_id, job["id"], "connection refused")

    runs = await get_runs(job["id"])
    assert runs[0]["status"] == "failed"
    assert runs[0]["exit_code"] == 1


@pytest.mark.asyncio
async def test_history_limit_enforced():
    """Wenn mehr Runs als das Limit existieren, werden ältere gelöscht."""
    job = await create_job("History Test", "ssh", "0 * * * *", {}, created_by="admin")

    # History-Limit auf 3 setzen
    await set_history_limit(3, "admin")

    # 5 Runs erstellen
    for i in range(5):
        run_id = await create_run(job["id"], "scheduler")
        await finish_run(run_id, job["id"], f"run {i}", 0)

    runs = await get_runs(job["id"])
    assert len(runs) <= 3


@pytest.mark.asyncio
async def test_run_output_truncated():
    """Output über 50 KB wird abgeschnitten."""
    job = await create_job("Truncate Test", "ssh", "0 * * * *", {}, created_by="admin")
    run_id = await create_run(job["id"], "manual")
    big_output = "x" * 100_000  # 100 KB
    await finish_run(run_id, job["id"], big_output, 0)

    runs = await get_runs(job["id"])
    assert len(runs[0]["output"]) <= 51200


# ── Settings ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_settings_defaults():
    s = await get_settings()
    assert s["history_limit"] == 20
    assert s["has_system_ssh_key"] is False


@pytest.mark.asyncio
async def test_set_history_limit():
    await set_history_limit(50, "admin")
    s = await get_settings()
    assert s["history_limit"] == 50


# ── Zeitfenster-Modus (Parent/Child) ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_parent_child_jobs():
    parent = await create_job(
        "Parent", "power_action", "0 8 * * *",
        {"node": "pve1", "vmid": 101, "vmtype": "qemu", "action": "start"},
        created_by="admin",
    )
    child = await create_job(
        "Child Stop", "power_action", "0 20 * * *",
        {"node": "pve1", "vmid": 101, "vmtype": "qemu", "action": "stop"},
        created_by="admin",
        parent_job_id=parent["id"],
    )

    parent_fetched = await get_job(parent["id"])
    assert parent_fetched["child_job"] is not None  # type: ignore[index]
    assert parent_fetched["child_job"]["id"] == child["id"]  # type: ignore[index]


@pytest.mark.asyncio
async def test_list_only_returns_parents():
    """list_jobs gibt nur Parent-Jobs zurück, keine Child-Jobs direkt."""
    parent = await create_job("Parent", "power_action", "0 8 * * *", {}, created_by="admin")
    await create_job("Child", "power_action", "0 20 * * *", {}, created_by="admin", parent_job_id=parent["id"])

    jobs = await list_jobs("admin", is_admin=True)
    ids = [j["id"] for j in jobs]
    assert parent["id"] in ids
