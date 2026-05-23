# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-63: Playbook-Permission-Tabellen mit eigener MetaData – Plus-Modul-Eigentum.

Diese MetaData-Instanz ist bewusst von backend.db.models.metadata getrennt:
- Core-Code importiert dieses Modul nie (AGPL/Plus-Trennung via PROJ-60).
- plus/__init__.py ruft create_all(engine, plus_metadata) beim App-Start.
- Das ist idempotent – existierende Whitelist-Daten bleiben unberührt (AC-DB-2/6).
- FKs auf Core-Tabelle local_users sind String-Referenzen;
  SQLAlchemy generiert daraus korrekte REFERENCES-Klauseln im DDL.

One-Shot-Migration (_migrate_default_mode):
  Liest portal_config.default_playbook_mode (falls vorhanden) →
  INSERT OR IGNORE in playbook_permissions_config(id=1, default_mode=…) →
  DELETE aus portal_config.  Idempotent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    text,
)

plus_metadata = MetaData()

# Phantom-Eintrag für Core-Tabelle local_users – nur für FK-Auflösung.
# Wird von plus_metadata.create_all(checkfirst=True) übersprungen,
# weil sie bereits von Core-init_db() erstellt wurde.
Table("local_users", plus_metadata, Column("id", Integer, primary_key=True), keep_existing=True)

# ── playbook_permissions ──────────────────────────────────────────────────────

playbook_permissions = Table(
    "playbook_permissions", plus_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("playbook_name", String, nullable=False),
    Column("subject_type", String(10), nullable=False),
    Column("subject_id", Integer, nullable=False),
    Column("added_at", String, nullable=False),
    Column("added_by_user_id", Integer, ForeignKey("local_users.id", ondelete="SET NULL")),
    CheckConstraint(
        "subject_type IN ('user', 'group')",
        name="ck_playbook_permissions_subject_type",
    ),
    UniqueConstraint(
        "playbook_name", "subject_type", "subject_id",
        name="uq_playbook_permissions_entry",
    ),
)

Index("idx_pp_subject",       playbook_permissions.c.subject_type, playbook_permissions.c.subject_id)
Index("idx_pp_playbook_name", playbook_permissions.c.playbook_name)

# ── playbook_permissions_config (Single-Row, PROJ-63) ────────────────────────

playbook_permissions_config = Table(
    "playbook_permissions_config", plus_metadata,
    Column("id", Integer, primary_key=True),   # CHECK(id=1) via constraint
    Column("default_mode", String(10), nullable=False, server_default="open"),
    Column("updated_at", String),
    Column("updated_by_user_id", Integer, ForeignKey("local_users.id", ondelete="SET NULL")),
    CheckConstraint("id = 1",                                          name="ck_ppc_single_row"),
    CheckConstraint("default_mode IN ('open', 'restricted')",          name="ck_ppc_default_mode"),
)


# ── One-Shot-Migration ────────────────────────────────────────────────────────

def _migrate_default_mode(engine) -> None:
    """Liest portal_config.default_playbook_mode und schreibt es nach
    playbook_permissions_config.  Danach wird der portal_config-Schlüssel gelöscht.
    Idempotent: INSERT OR IGNORE → zweiter Run ist No-Op.
    """
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT value FROM portal_config WHERE key = 'default_playbook_mode'")
            ).fetchone()
            mode_value = row[0] if row else "open"

            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                text(
                    "INSERT OR IGNORE INTO playbook_permissions_config "
                    "(id, default_mode, updated_at, updated_by_user_id) "
                    "VALUES (1, :mode, :now, NULL)"
                ),
                {"mode": mode_value, "now": now},
            )
            conn.execute(
                text("DELETE FROM portal_config WHERE key = 'default_playbook_mode'")
            )
            conn.commit()
        logger.info(
            "PROJ-63: default_playbook_mode migriert (mode=%s) oder bereits migriert", mode_value
        )
    except Exception as exc:
        logger.warning("PROJ-63: _migrate_default_mode fehlgeschlagen: %s", exc)
