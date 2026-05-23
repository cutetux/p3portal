# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Tests für ensure_plus_db_tables() – DDL-Idempotenz + Tabellen-Existenz."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

pytestmark = pytest.mark.plus_only


@pytest.fixture()
def sync_engine(tmp_path):
    url = f"sqlite:///{tmp_path}/test_sj.db"
    eng = create_engine(url, echo=False)
    yield eng
    eng.dispose()


def test_ensure_creates_scheduled_jobs_table(sync_engine):
    """ensure_plus_db_tables() legt scheduled_jobs an wenn die Tabelle fehlt."""
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    ensure_plus_db_tables(sync_engine)
    insp = inspect(sync_engine)
    assert "scheduled_jobs" in insp.get_table_names()


def test_ensure_creates_scheduled_job_runs_table(sync_engine):
    """ensure_plus_db_tables() legt scheduled_job_runs an wenn die Tabelle fehlt."""
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    ensure_plus_db_tables(sync_engine)
    insp = inspect(sync_engine)
    assert "scheduled_job_runs" in insp.get_table_names()


def test_ensure_is_idempotent(sync_engine):
    """ensure_plus_db_tables() kann ohne Fehler zweimal aufgerufen werden."""
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    ensure_plus_db_tables(sync_engine)
    ensure_plus_db_tables(sync_engine)  # zweiter Aufruf darf nicht werfen
    insp = inspect(sync_engine)
    assert "scheduled_jobs" in insp.get_table_names()


def test_scheduled_jobs_check_constraint_includes_git_sync(sync_engine):
    """Plus-Tabelle erlaubt job_type='git_sync' (Core-Tabelle hätte es nicht)."""
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    ensure_plus_db_tables(sync_engine)
    with sync_engine.connect() as conn:
        now = "2026-01-01T00:00:00"
        conn.execute(text(
            "INSERT INTO scheduled_jobs "
            "(id, name, job_type, cron_expression, config, active, created_by, created_at, updated_at) "
            "VALUES ('test-id', 'test', 'git_sync', '* * * * *', '{}', 1, 'admin', :now, :now)"
        ), {"now": now})
        conn.commit()
        row = conn.execute(
            text("SELECT job_type FROM scheduled_jobs WHERE id='test-id'")
        ).fetchone()
    assert row[0] == "git_sync"


def test_upgrade_preserves_existing_data(sync_engine):
    """Bei Upgrade-Installation (Tabellen existieren bereits) bleiben Daten erhalten."""
    from backend.plus.scheduled_jobs import ensure_plus_db_tables
    # Erste Erstellung + Daten einfügen
    ensure_plus_db_tables(sync_engine)
    now = "2026-01-01T00:00:00"
    with sync_engine.connect() as conn:
        conn.execute(text(
            "INSERT INTO scheduled_jobs "
            "(id, name, job_type, cron_expression, config, active, created_by, created_at, updated_at) "
            "VALUES ('existing-id', 'existing', 'ssh', '0 * * * *', '{}', 1, 'admin', :now, :now)"
        ), {"now": now})
        conn.commit()
    # Zweiter ensure-Aufruf (simulates app restart / upgrade)
    ensure_plus_db_tables(sync_engine)
    with sync_engine.connect() as conn:
        row = conn.execute(
            text("SELECT name FROM scheduled_jobs WHERE id='existing-id'")
        ).fetchone()
    assert row is not None
    assert row[0] == "existing"
