# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Scheduled-Jobs-Tabellen mit eigener Plus-MetaData().

Eigene MetaData() trennt diese Tabellen vom Core-Schema.
Phantom-Tabellen (keep_existing=True) lösen Cross-MetaData-FKs auf.
"""
from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
)

# Eigene MetaData – getrennt von backend.db.models.metadata und approvals/models.py
plus_metadata = MetaData()

# ── Phantom-Tabellen (FK-Auflösung, werden NICHT erstellt) ────────────────────
# keep_existing=True: SQLAlchemy überschreibt nicht, falls schon in dieser MetaData

local_users_phantom = Table(
    "local_users", plus_metadata,
    Column("id", Integer, primary_key=True),
    keep_existing=True,
)

playbooks_phantom = Table(
    "playbooks", plus_metadata,
    Column("id", Integer, primary_key=True),
    keep_existing=True,
)

nodes_phantom = Table(
    "nodes", plus_metadata,
    Column("id", Integer, primary_key=True),
    keep_existing=True,
)

jobs_phantom = Table(
    "jobs", plus_metadata,
    Column("id", String, primary_key=True),
    keep_existing=True,
)


# ── scheduled_jobs (PROJ-35, jetzt Plus-only) ─────────────────────────────────
# Schema-identisch zu backend/db/models.py (vor Migration),
# CHECK constraint erweitert um 'git_sync' (PROJ-68).
# Kein auto_owner_user_id – diese Spalte gehört zu jobs (Ansible-Jobs), nicht scheduled_jobs.

scheduled_jobs = Table(
    "scheduled_jobs", plus_metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("description", Text),
    Column("job_type", String(20), nullable=False),
    Column("cron_expression", String, nullable=False),
    Column("active", Integer, nullable=False, server_default="1"),
    Column("config", Text, nullable=False, server_default="{}"),
    Column("created_by", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
    Column("last_run_at", String),
    Column("last_run_status", String),
    Column("next_run_at", String),
    Column("parent_job_id", String),  # Self-ref via App-Level (kein FK in eigener MetaData)
    CheckConstraint(
        "job_type IN ('playbook', 'ssh', 'power_action', 'git_sync')",
        name="ck_scheduled_jobs_type",
    ),
)

Index("idx_scheduled_jobs_created_by",  scheduled_jobs.c.created_by)
Index("idx_scheduled_jobs_active",      scheduled_jobs.c.active)
Index("idx_scheduled_jobs_next_run_at", scheduled_jobs.c.next_run_at)
Index("idx_scheduled_jobs_parent",      scheduled_jobs.c.parent_job_id)


# ── scheduled_job_runs (PROJ-35, jetzt Plus-only) ─────────────────────────────

scheduled_job_runs = Table(
    "scheduled_job_runs", plus_metadata,
    Column("id", String, primary_key=True),
    Column("job_id", String, nullable=False),  # FK via App-Level (CASCADE via service)
    Column("started_at", String, nullable=False),
    Column("finished_at", String),
    Column("status", String(10), nullable=False, server_default="running"),
    Column("exit_code", Integer),
    Column("output", Text),
    Column("triggered_by", String, nullable=False, server_default="scheduler"),
    Column("action", String),
    CheckConstraint(
        "status IN ('running', 'success', 'failed')",
        name="ck_scheduled_job_runs_status",
    ),
)

Index("idx_scheduled_job_runs_job_id",     scheduled_job_runs.c.job_id)
Index("idx_scheduled_job_runs_started_at", scheduled_job_runs.c.started_at)
Index("idx_scheduled_job_runs_status",     scheduled_job_runs.c.status)
