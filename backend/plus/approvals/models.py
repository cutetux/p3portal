# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-64: Plus-eigene Datenmodelle für Approval-Workflow.

Eigene MetaData() analog PROJ-62 (Pools) + PROJ-63 (Playbook-Permissions).
Phantom-Tabellen (local_users, jobs, groups, scheduled_jobs) mit keep_existing=True
für FK-Auflösung über MetaData-Grenzen hinweg.

Neue Plus-Tabellen:
  approval_rules           – migriert aus Core db/models.py
  pending_approvals        – migriert aus Core db/models.py
  approval_workflow_config – NEU: Single-Row, ersetzt 4 portal_config-Keys
  scheduled_job_approval_status – NEU: ersetzt scheduled_jobs.approval_status-Spalte

Alte Core-Tabellen werden via ensure_plus_db_tables() in __init__.py gedroppt.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)

# ─────────────────────────────────────────────────────────────────────────────
# Plus-MetaData (getrennt von Core-MetaData)
# ─────────────────────────────────────────────────────────────────────────────

plus_metadata = MetaData()

# ── Phantom-Tabellen (FK-Auflösung, werden von Core verwaltet) ───────────────

Table("local_users",    plus_metadata, Column("id", Integer, primary_key=True), keep_existing=True)
Table("jobs",           plus_metadata, Column("id", String,  primary_key=True), keep_existing=True)
Table("groups",         plus_metadata, Column("id", Integer, primary_key=True), keep_existing=True)
Table("scheduled_jobs", plus_metadata, Column("id", String,  primary_key=True), keep_existing=True)

# ── approval_rules (migriert aus Core, PROJ-50) ───────────────────────────────

approval_rules = Table(
    "approval_rules", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("action_type", String(40), nullable=False),
    Column("action_target", String(255), nullable=False),
    Column("required", Integer, nullable=False, server_default="0"),
    Column("approver_groups", Text, nullable=False, server_default="[]"),
    Column("approver_users",  Text, nullable=False, server_default="[]"),
    Column("expiration_hours", Integer, nullable=False, server_default="48"),
    Column("allow_self_approval", Integer, nullable=False, server_default="0"),
    Column("source", String(15), nullable=False),
    Column("is_active", Integer, nullable=False, server_default="1"),
    Column("meta_yaml_snapshot", Text),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
    Column("updated_by_user_id", Integer,
           ForeignKey("local_users.id", ondelete="SET NULL")),
    CheckConstraint(
        "action_type IN ('playbook_run','packer_build','vm_delete','lxc_delete',"
        "'template_delete','owner_delete_request','owner_adopt_request')",
        name="ck_approval_rules_action_type",
    ),
    CheckConstraint(
        "source IN ('meta_yaml','ui_override')",
        name="ck_approval_rules_source",
    ),
    UniqueConstraint("action_type", "action_target", name="uq_approval_rules_action"),
)

Index("idx_approval_rules_action_type", approval_rules.c.action_type)
Index("idx_approval_rules_is_active",   approval_rules.c.is_active)

# ── pending_approvals (migriert aus Core, PROJ-50) ────────────────────────────

pending_approvals = Table(
    "pending_approvals", plus_metadata,
    Column("id", String(30), primary_key=True),
    Column("action_type", String(40), nullable=False),
    Column("action_target", String(255), nullable=False),
    Column("payload", Text, nullable=False, server_default="{}"),
    Column("payload_hash", String(64), nullable=False),
    Column("payload_secret_blob", Text),
    Column("requester_user_id", Integer,
           ForeignKey("local_users.id", ondelete="RESTRICT")),
    Column("requested_at", String, nullable=False),
    Column("expires_at", String, nullable=False),
    Column("status", String(15), nullable=False, server_default="pending"),
    Column("decided_by_user_id", Integer,
           ForeignKey("local_users.id", ondelete="SET NULL")),
    Column("decided_at", String),
    Column("decided_reason", Text),
    Column("self_approval", Integer, nullable=False, server_default="0"),
    Column("job_id", String, ForeignKey("jobs.id", ondelete="SET NULL")),
    Column("parent_approval_id", String(30),
           ForeignKey("pending_approvals.id", ondelete="SET NULL")),
    Column("rule_snapshot", Text, nullable=False, server_default="{}"),
    CheckConstraint(
        "status IN ('pending','approved','rejected','cancelled','expired','suspended','executed')",
        name="ck_pending_approvals_status",
    ),
)

Index("idx_pa_status",        pending_approvals.c.status)
Index("idx_pa_requester",     pending_approvals.c.requester_user_id)
Index("idx_pa_expires_at",    pending_approvals.c.expires_at)
Index("idx_pa_action_status", pending_approvals.c.action_type,
      pending_approvals.c.action_target, pending_approvals.c.status)

# ── approval_workflow_config (NEU, PROJ-64: Single-Row) ───────────────────────
# Ersetzt 4 portal_config-Keys: approval_workflow_enabled, default_approver_group_id,
# default_expiration_hours, allow_self_approval_global.
# Constraint id=1 stellt sicher, dass immer nur eine Zeile existiert.

approval_workflow_config = Table(
    "approval_workflow_config", plus_metadata,
    Column("id", Integer, primary_key=True,
           server_default="1"),
    Column("enabled", Boolean, nullable=False, server_default="0"),
    Column("default_approver_group_id", Integer,
           ForeignKey("groups.id", ondelete="SET NULL"), nullable=True),
    Column("default_expiration_hours", Integer, nullable=False, server_default="48"),
    Column("allow_self_approval_global", Boolean, nullable=False, server_default="0"),
    Column("updated_at", String),
    Column("updated_by_user_id", Integer,
           ForeignKey("local_users.id", ondelete="SET NULL")),
    CheckConstraint("id = 1", name="ck_approval_workflow_config_single_row"),
)

# ── scheduled_job_approval_status (NEU, PROJ-64) ─────────────────────────────
# Ersetzt scheduled_jobs.approval_status-Spalte in der Core-Tabelle.

scheduled_job_approval_status = Table(
    "scheduled_job_approval_status", plus_metadata,
    Column("scheduled_job_id", String, ForeignKey("scheduled_jobs.id", ondelete="CASCADE"),
           primary_key=True),
    Column("status", String(20), nullable=False),
    Column("reason", Text),
    Column("updated_at", String),
    CheckConstraint(
        "status IN ('pending_approval', 'suspended')",
        name="ck_sjas_status",
    ),
)

Index("idx_sjas_status", scheduled_job_approval_status.c.status)
