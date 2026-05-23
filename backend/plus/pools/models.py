# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-62: Pool-Tabellen mit eigener MetaData – Plus-Modul-Eigentum.

Diese MetaData-Instanz ist bewusst von backend.db.models.metadata getrennt:
- Core-Code importiert dieses Modul nie (AGPL/Plus-Trennung via PROJ-60).
- plus/__init__.py ruft create_all(engine, plus_metadata) beim App-Start.
- Das ist idempotent – existierende Pool-Daten bleiben unberührt (AC-DB-2).
- FKs auf Core-Tabellen (nodes, role_presets) sind String-Referenzen;
  SQLAlchemy generiert daraus korrekte REFERENCES-Klauseln im DDL.
"""
from __future__ import annotations

from sqlalchemy import (
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
    func,
)

plus_metadata = MetaData()

# Phantom-Einträge für Core-Tabellen – nur für FK-Auflösung in sort_tables_and_constraints.
# Diese Tabellen werden von plus_metadata.create_all(checkfirst=True) übersprungen,
# weil sie bereits von Core-init_db() erstellt wurden.
Table("nodes",        plus_metadata, Column("id", Integer, primary_key=True), keep_existing=True)
Table("role_presets", plus_metadata, Column("id", Integer, primary_key=True), keep_existing=True)

# ── pools ─────────────────────────────────────────────────────────────────────

pools = Table(
    "pools", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(64), nullable=False),
    Column("description", Text),
    Column("tags", Text, nullable=False, server_default="[]"),
    # Owner: polymorph – kein Hard-FK; Service übernimmt Cleanup
    Column("owner_subject_type", String(10)),
    Column("owner_subject_id", Integer),
    # Quotas: 0 = unbegrenzt, >0 = Limit
    Column("cpu_quota", Integer, nullable=False, server_default="0"),
    Column("ram_quota_mb", Integer, nullable=False, server_default="0"),
    Column("disk_quota_gb", Integer, nullable=False, server_default="0"),
    Column("vm_count_quota", Integer, nullable=False, server_default="0"),
    Column("created_at", String, nullable=False),
    Column("created_by", String, nullable=False),
    CheckConstraint(
        "owner_subject_type IN ('user', 'group')",
        name="ck_pools_owner_type",
    ),
    CheckConstraint("cpu_quota >= 0",      name="ck_pools_cpu_quota"),
    CheckConstraint("ram_quota_mb >= 0",   name="ck_pools_ram_quota"),
    CheckConstraint("disk_quota_gb >= 0",  name="ck_pools_disk_quota"),
    CheckConstraint("vm_count_quota >= 0", name="ck_pools_vm_count_quota"),
)

Index("uq_pools_name_lower", func.lower(pools.c.name), unique=True)
Index("idx_pools_owner", pools.c.owner_subject_type, pools.c.owner_subject_id)

# ── pool_members ──────────────────────────────────────────────────────────────

pool_members = Table(
    "pool_members", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("pool_id", Integer, ForeignKey("pools.id", ondelete="CASCADE"), nullable=False),
    Column("resource_type", String(4), nullable=False),
    # FK auf Core-Tabelle nodes – String-Referenz (cross-MetaData)
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("vmid", Integer, nullable=False),
    Column("added_at", String, nullable=False),
    Column("added_by", String, nullable=False),
    UniqueConstraint("node_id", "vmid", name="uq_pool_members_vm"),
    CheckConstraint(
        "resource_type IN ('vm', 'lxc')",
        name="ck_pool_members_resource_type",
    ),
)

Index("idx_pool_members_pool_id",   pool_members.c.pool_id)
Index("idx_pool_members_node_vmid", pool_members.c.node_id, pool_members.c.vmid)

# ── pool_assignments ──────────────────────────────────────────────────────────

pool_assignments = Table(
    "pool_assignments", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("pool_id", Integer, ForeignKey("pools.id", ondelete="CASCADE"), nullable=False),
    Column("subject_type", String(5), nullable=False),
    Column("subject_id", Integer, nullable=False),
    # FK auf Core-Tabelle role_presets – String-Referenz (cross-MetaData)
    Column("role_preset_id", Integer, ForeignKey("role_presets.id", ondelete="CASCADE"), nullable=False),
    Column("added_at", String, nullable=False),
    Column("added_by", String, nullable=False),
    UniqueConstraint("pool_id", "subject_type", "subject_id", name="uq_pool_assignments"),
    CheckConstraint(
        "subject_type IN ('user', 'group')",
        name="ck_pool_assignments_subject_type",
    ),
)

Index("idx_pool_assignments_pool_id", pool_assignments.c.pool_id)
Index("idx_pool_assignments_subject", pool_assignments.c.subject_type, pool_assignments.c.subject_id)
