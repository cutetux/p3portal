# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Git-Sync DB-Modelle – 4 Tabellen mit eigener Plus-MetaData."""
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
    UniqueConstraint,
)

plus_metadata = MetaData()

# ── git_sync_configs ──────────────────────────────────────────────────────────
# Ein Eintrag pro repo_type (max. 2 Zeilen: 'ansible', 'packer')

git_sync_configs = Table(
    "git_sync_configs", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("repo_type", String(16), nullable=False),    # 'ansible' | 'packer'
    Column("enabled", Integer, nullable=False, server_default="0"),  # bool as int
    Column("repo_url", String(512), nullable=False, server_default=""),
    Column("branch", String(128), nullable=False, server_default="main"),
    Column("subdir", String(256), nullable=True),
    Column("auth_method", String(8), nullable=False, server_default="https"),
    Column("https_username", String(128), nullable=True),
    Column("https_token_enc", Text, nullable=True),      # Fernet-verschlüsselt
    Column("ssh_public_key", Text, nullable=True),       # Klartext, sicher
    Column("ssh_private_key_enc", Text, nullable=True),  # Fernet-verschlüsselt
    Column("webhook_token_enc", Text, nullable=True),    # Fernet-verschlüsselt, auto-gen
    Column("auto_sync_interval", Integer, nullable=False, server_default="0"),  # 0=disabled, Minuten
    Column("updated_at", String(32), nullable=True),
    Column("updated_by", String(128), nullable=True),
    UniqueConstraint("repo_type", name="uq_git_sync_configs_repo_type"),
    CheckConstraint(
        "repo_type IN ('ansible', 'packer')",
        name="ck_git_sync_configs_repo_type",
    ),
    CheckConstraint(
        "auth_method IN ('https', 'ssh')",
        name="ck_git_sync_configs_auth_method",
    ),
)

# ── git_sync_logs ──────────────────────────────────────────────────────────────
# Sync-Historie; max. 20 Einträge pro repo_type (ältere werden geprunt)

git_sync_logs = Table(
    "git_sync_logs", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("repo_type", String(16), nullable=False),
    Column("triggered_by", String(16), nullable=False),  # 'manual'|'scheduled_job'|'webhook'
    Column("started_at", String(32), nullable=False),
    Column("completed_at", String(32), nullable=True),
    Column("status", String(12), nullable=False, server_default="running"),
    Column("items_synced", Integer, nullable=False, server_default="0"),
    Column("items_conflicted", Integer, nullable=False, server_default="0"),
    Column("message", Text, nullable=True),
    Column("log_detail", Text, nullable=True),
    CheckConstraint(
        "triggered_by IN ('manual', 'scheduled_job', 'webhook')",
        name="ck_git_sync_logs_triggered_by",
    ),
    CheckConstraint(
        "status IN ('running', 'success', 'failed')",
        name="ck_git_sync_logs_status",
    ),
)

Index("idx_git_sync_logs_repo_type", git_sync_logs.c.repo_type)
Index("idx_git_sync_logs_started_at", git_sync_logs.c.started_at)

# ── git_sync_sources ──────────────────────────────────────────────────────────
# Source-Tracking: welche Items stammen aus Git (vs. ZIP-Upload)?

git_sync_sources = Table(
    "git_sync_sources", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("repo_type", String(16), nullable=False),
    Column("item_id", String(128), nullable=False),  # Verzeichnisname = Playbook/Template-ID
    Column("git_hash", String(64), nullable=False),  # Letzter Commit-Hash beim Import
    Column("synced_at", String(32), nullable=False),
    UniqueConstraint("repo_type", "item_id", name="uq_git_sync_sources_item"),
    CheckConstraint(
        "repo_type IN ('ansible', 'packer')",
        name="ck_git_sync_sources_repo_type",
    ),
)

Index("idx_git_sync_sources_repo_item", git_sync_sources.c.repo_type, git_sync_sources.c.item_id)

# ── git_sync_conflicts ────────────────────────────────────────────────────────
# Konflikt-Tracking: Items die sowohl lokal (ZIP) als auch in Git existieren

git_sync_conflicts = Table(
    "git_sync_conflicts", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("repo_type", String(16), nullable=False),
    Column("item_id", String(128), nullable=False),
    Column("git_hash", String(64), nullable=False),
    Column("detected_at", String(32), nullable=False),
    Column("resolved_at", String(32), nullable=True),
    Column("resolution", String(8), nullable=True),   # 'git' | 'local' | NULL=offen
    Column("resolved_by", String(128), nullable=True),
    CheckConstraint(
        "repo_type IN ('ansible', 'packer')",
        name="ck_git_sync_conflicts_repo_type",
    ),
    CheckConstraint(
        "resolution IS NULL OR resolution IN ('git', 'local')",
        name="ck_git_sync_conflicts_resolution",
    ),
)

Index("idx_git_sync_conflicts_open", git_sync_conflicts.c.repo_type, git_sync_conflicts.c.resolved_at)
