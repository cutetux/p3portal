# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-63: Tests für _migrate_default_mode() – One-Shot-Migration.

Szenarien:
1. portal_config hat keinen default_playbook_mode → INSERT 'open'
2. portal_config hat default_playbook_mode → übertragen + aus portal_config gelöscht
3. Idempotenz: zweiter Run ist No-Op (INSERT OR IGNORE)
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text

from backend.plus.playbook_permissions.models import plus_metadata

pytestmark = pytest.mark.plus_only


def _make_engine(tmp_path):
    """Erstellt eine frische Sync-SQLite-Engine für Migration-Tests."""
    db_path = tmp_path / "migrate_test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    # Core-Tabelle portal_config anlegen (minimal)
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE portal_config ("
            "  key TEXT PRIMARY KEY, "
            "  value TEXT, "
            "  is_secret INTEGER DEFAULT 0, "
            "  updated_at TEXT, "
            "  updated_by TEXT"
            ")"
        ))
        conn.commit()
    # Plus-Tabellen (playbook_permissions + playbook_permissions_config) anlegen
    plus_metadata.create_all(engine, checkfirst=True)
    return engine


def _get_config_mode(engine) -> str | None:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT default_mode FROM playbook_permissions_config WHERE id=1")
        ).fetchone()
        return row[0] if row else None


def _portal_config_has_key(engine, key: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM portal_config WHERE key=:key"), {"key": key}
        ).fetchone()
        return row is not None


def _insert_portal_config(engine, key: str, value: str):
    with engine.connect() as conn:
        conn.execute(
            text("INSERT OR REPLACE INTO portal_config (key, value) VALUES (:k, :v)"),
            {"k": key, "v": value},
        )
        conn.commit()


# ── Szenario 1: kein portal_config-Eintrag → Fallback 'open' ─────────────────

def test_migration_no_portal_config_uses_open(tmp_path):
    from backend.plus.playbook_permissions.models import _migrate_default_mode
    engine = _make_engine(tmp_path)
    _migrate_default_mode(engine)
    assert _get_config_mode(engine) == "open"


# ── Szenario 2: portal_config hat 'restricted' → übertragen + gelöscht ───────

def test_migration_transfers_existing_mode(tmp_path):
    from backend.plus.playbook_permissions.models import _migrate_default_mode
    engine = _make_engine(tmp_path)
    _insert_portal_config(engine, "default_playbook_mode", "restricted")
    _migrate_default_mode(engine)
    assert _get_config_mode(engine) == "restricted"
    assert not _portal_config_has_key(engine, "default_playbook_mode")


# ── Szenario 3: Idempotenz ────────────────────────────────────────────────────

def test_migration_idempotent(tmp_path):
    from backend.plus.playbook_permissions.models import _migrate_default_mode
    engine = _make_engine(tmp_path)
    _insert_portal_config(engine, "default_playbook_mode", "restricted")
    _migrate_default_mode(engine)
    # Zweiter Aufruf darf die erste Eintragung nicht überschreiben
    _migrate_default_mode(engine)
    assert _get_config_mode(engine) == "restricted"


# ── BUG-63-2: ensure_plus_db_tables erstellt Tabellen auf Erstinstallation ────

def test_ensure_plus_db_tables_creates_tables_on_fresh_install(tmp_path, monkeypatch):
    """BUG-63-2: ensure_plus_db_tables() muss Tabellen auf Erstinstallation anlegen.

    Simuliert den Timing-Bug: backend.plus.__init__ wurde schon durch einen Submodul-Import
    ausgeführt, als get_sync_engine() noch None war. Die Tabellen werden erst nach dem
    expliziten Aufruf von ensure_plus_db_tables() (nach init_db()) korrekt angelegt.
    """
    from sqlalchemy import create_engine, inspect as sa_inspect
    db_path = tmp_path / "fresh.db"
    fresh_engine = create_engine(f"sqlite:///{db_path}")

    # Core-Minimalschema anlegen (local_users + portal_config)
    with fresh_engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE local_users (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "
            "username TEXT NOT NULL UNIQUE)"
        ))
        conn.execute(text(
            "CREATE TABLE portal_config (key TEXT PRIMARY KEY, value TEXT, "
            "is_secret INTEGER DEFAULT 0, updated_at TEXT, updated_by TEXT)"
        ))
        conn.commit()

    # Patch get_sync_engine → frische Engine zurückgeben (simuliert Zeitpunkt nach init_db())
    import backend.db.database as _db_mod
    monkeypatch.setattr(_db_mod, "get_sync_engine", lambda: fresh_engine)

    # ensure_plus_db_tables() direkt auf _PlusGateBehavior aufrufen
    import backend.plus as _plus_pkg
    gate = _plus_pkg._PlusGateBehavior()
    gate.ensure_plus_db_tables()

    tables = sa_inspect(fresh_engine).get_table_names()
    assert "playbook_permissions" in tables, f"playbook_permissions fehlt in {tables}"
    assert "playbook_permissions_config" in tables, f"playbook_permissions_config fehlt in {tables}"
    assert _get_config_mode(fresh_engine) == "open"
