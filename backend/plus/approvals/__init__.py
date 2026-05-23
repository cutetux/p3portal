# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-64: Approval-Workflow-Plus-Modul.

Enthält ensure_plus_db_tables(): One-Shot-Datenmigration + DDL.

Migriert bei Plus-Erstinstallation oder Upgrade:
  - approval_rules          Core-Tabelle → Plus-MetaData
  - pending_approvals       Core-Tabelle → Plus-MetaData
  - 4 portal_config-Keys   → approval_workflow_config (Single-Row)
  - scheduled_jobs.approval_status-Spalte → scheduled_job_approval_status
  - owner_delete_requests   (PROJ-48-Stub, DROP TABLE IF EXISTS)

Idempotent: Existenz-Check auf approval_workflow_config-Zeile id=1.
Rollback: Bei Fehler → _migration_failed=True auf ApprovalsModuleState,
          Plus-Hooks liefern Core-Defaults.
"""
from __future__ import annotations

import logging

from .router import router

logger = logging.getLogger(__name__)

__all__ = ["router", "ensure_plus_db_tables"]


class _ApprovalsModuleState:
    """Zustand des Plus-Moduls; Singleton."""
    migration_failed: bool = False
    migration_ran: bool = False


_state = _ApprovalsModuleState()


def ensure_plus_db_tables(engine) -> None:
    """Erstellt Plus-Tabellen und migriert Core-Bestandsdaten idempotent.

    Wird von plus/__init__.py::ensure_plus_db_tables() nach init_db() aufgerufen.
    Alle Schritte in einer Transaktion. Bei Fehler: ROLLBACK + _migration_failed.
    """
    from .models import plus_metadata

    # Schritt 1: DDL – Plus-Tabellen anlegen (Phantom-Tabellen werden übersprungen)
    try:
        plus_metadata.create_all(engine, checkfirst=True)
        logger.debug("PROJ-64: Approval-Plus-Tabellen sichergestellt (DDL)")
    except Exception as exc:
        logger.error("PROJ-64: DDL create_all fehlgeschlagen: %s", exc)
        _state.migration_failed = True
        return

    # Schritt 2: Idempotenz-Check – Zeile id=1 in approval_workflow_config vorhanden?
    try:
        with engine.connect() as conn:
            row = conn.execute(
                __import__("sqlalchemy").text(
                    "SELECT id FROM approval_workflow_config WHERE id=1"
                )
            ).fetchone()
            if row is not None:
                logger.debug("PROJ-64: Migration bereits gelaufen (Idempotenz-Check)")
                _state.migration_ran = True
                return
    except Exception as exc:
        logger.warning("PROJ-64: Idempotenz-Check fehlgeschlagen: %s", exc)
        # Tabelle existiert noch nicht (Erstinstallation ohne Bestandsdaten) → weitermachen

    # Schritt 3–8: Migration in einer Transaktion
    _run_migration(engine)

    # Schritt 9: DDL nochmal sicherstellen – falls Migration Tabellen gedroppt hat
    # oder create_all (Schritt 1) partiell fehlschlug.
    if not _state.migration_failed:
        try:
            plus_metadata.create_all(engine, checkfirst=True)
            logger.debug("PROJ-64: Post-Migration DDL sichergestellt")
        except Exception as exc:
            logger.warning("PROJ-64: Post-Migration create_all fehlgeschlagen: %s", exc)


def _run_migration(engine) -> None:
    """Führt die One-Shot-Datenmigration durch. Atomic mit ROLLBACK bei Fehler."""
    from sqlalchemy import text

    logger.info("PROJ-64: Starte Approval-Workflow-Datenmigration …")

    try:
        with engine.begin() as conn:
            _migrate_approval_rules(conn, text)
            _migrate_pending_approvals(conn, text)
            _migrate_portal_config_keys(conn, text)
            _migrate_scheduled_job_approval_status(conn, text)
            _drop_owner_delete_requests(conn, text)
            # engine.begin() macht auto-commit bei Erfolg
        logger.info("PROJ-64: Approval-Workflow-Datenmigration abgeschlossen ✓")
        _state.migration_ran = True

    except Exception as exc:
        logger.error(
            "PROJ-64: Datenmigration FEHLGESCHLAGEN – ROLLBACK. "
            "Approval-Workflow nicht verfügbar. Fehler: %s",
            exc,
        )
        _state.migration_failed = True


def _table_exists(conn, text, table_name: str) -> bool:
    # SQLite: sqlite_master (kein UNION ALL – verhindert Connection-State-Korruption in engine.begin())
    try:
        row = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": table_name},
        ).fetchone()
        if row is not None:
            return True
    except Exception:
        pass
    # PostgreSQL: information_schema (separater Fallback, nicht per UNION ALL)
    try:
        row = conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name=:n"
            ),
            {"n": table_name},
        ).fetchone()
        return row is not None
    except Exception:
        return False


def _column_exists(conn, text, table_name: str, column_name: str) -> bool:
    """Prüft ob eine Spalte in einer Tabelle existiert (SQLite + PostgreSQL)."""
    try:
        # SQLite
        rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        if rows:
            return any(r[1] == column_name for r in rows)
    except Exception:
        pass
    try:
        # PostgreSQL
        row = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name=:t AND column_name=:c"
            ),
            {"t": table_name, "c": column_name},
        ).fetchone()
        return row is not None
    except Exception:
        return False


def _migrate_approval_rules(conn, text) -> None:
    """Übergibt approval_rules von Core-MetaData an Plus-MetaData (Ownership-Transfer).

    Core-MetaData definiert diese Tabelle seit PROJ-64 nicht mehr; Plus-MetaData
    übernimmt sie mit identischem Schema. Kein DROP nötig – create_all(checkfirst=True)
    lässt die vorhandene Tabelle unberührt und Plus verwaltet sie ab sofort.
    """
    if not _table_exists(conn, text, "approval_rules"):
        logger.debug("PROJ-64: approval_rules nicht vorhanden – wird durch create_all erstellt")
        return
    logger.debug("PROJ-64: approval_rules vorhanden – Plus-MetaData übernimmt Ownership ✓")


def _migrate_pending_approvals(conn, text) -> None:
    """Übergibt pending_approvals von Core-MetaData an Plus-MetaData (Ownership-Transfer).

    Analog zu _migrate_approval_rules: identisches Schema, kein DROP nötig.
    """
    if not _table_exists(conn, text, "pending_approvals"):
        logger.debug("PROJ-64: pending_approvals nicht vorhanden – wird durch create_all erstellt")
        return
    logger.debug("PROJ-64: pending_approvals vorhanden – Plus-MetaData übernimmt Ownership ✓")


def _migrate_portal_config_keys(conn, text) -> None:
    """Liest 4 portal_config-Keys und schreibt sie in approval_workflow_config (id=1)."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()

    # Alle 4 Keys auslesen
    def _read_config(key: str, default):
        try:
            row = conn.execute(
                text("SELECT value FROM portal_config WHERE key=:k"),
                {"k": key},
            ).fetchone()
            return row[0] if row else default
        except Exception:
            return default

    enabled_raw      = _read_config("approval_workflow_enabled", "0")
    enabled          = str(enabled_raw).lower() in ("1", "true", "yes")
    group_id_raw     = _read_config("default_approver_group_id", None)
    exp_hours_raw    = _read_config("default_expiration_hours", "48")
    self_appr_raw    = _read_config("allow_self_approval_global", "0")

    try:
        group_id = int(group_id_raw) if group_id_raw else None
    except (TypeError, ValueError):
        group_id = None
    try:
        exp_hours = int(exp_hours_raw)
    except (TypeError, ValueError):
        exp_hours = 48
    self_approval = str(self_appr_raw).lower() in ("1", "true", "yes")

    conn.execute(
        text("""
            INSERT OR IGNORE INTO approval_workflow_config
                (id, enabled, default_approver_group_id, default_expiration_hours,
                 allow_self_approval_global, updated_at, updated_by_user_id)
            VALUES (1, :enabled, :gid, :exp, :self_appr, :now, NULL)
        """),
        {
            "enabled":    1 if enabled else 0,
            "gid":        group_id,
            "exp":        exp_hours,
            "self_appr":  1 if self_approval else 0,
            "now":        now,
        },
    )

    # Keys aus portal_config löschen
    for key in ("approval_workflow_enabled", "default_approver_group_id",
                "default_expiration_hours", "allow_self_approval_global"):
        conn.execute(
            text("DELETE FROM portal_config WHERE key=:k"),
            {"k": key},
        )

    logger.info("PROJ-64: portal_config-Approval-Keys nach approval_workflow_config migriert ✓")


def _migrate_scheduled_job_approval_status(conn, text) -> None:
    """Migriert scheduled_jobs.approval_status → scheduled_job_approval_status, dann DROP COLUMN."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()

    if not _column_exists(conn, text, "scheduled_jobs", "approval_status"):
        logger.debug("PROJ-64: scheduled_jobs.approval_status Spalte nicht vorhanden – skip")
        return

    # Nicht-NULL-Werte in Plus-Tabelle migrieren
    conn.execute(
        text("""
            INSERT OR IGNORE INTO scheduled_job_approval_status
                (scheduled_job_id, status, reason, updated_at)
            SELECT id, approval_status, NULL, :now
              FROM scheduled_jobs
             WHERE approval_status IS NOT NULL
               AND approval_status IN ('pending_approval', 'suspended')
        """),
        {"now": now},
    )

    # Spalte droppen (SQLite ≥3.35 + PostgreSQL)
    try:
        conn.execute(text("ALTER TABLE scheduled_jobs DROP COLUMN approval_status"))
        logger.info("PROJ-64: scheduled_jobs.approval_status migriert + DROP COLUMN ✓")
    except Exception as exc:
        # Ältere SQLite-Version: Spalte bleibt (wird ignoriert)
        logger.warning(
            "PROJ-64: DROP COLUMN approval_status fehlgeschlagen (SQLite <3.35?): %s. "
            "Spalte bleibt ungenutzt.",
            exc,
        )


def _drop_owner_delete_requests(conn, text) -> None:
    """Droppt owner_delete_requests (PROJ-48-Stub, war nie aktiv)."""
    conn.execute(text("DROP TABLE IF EXISTS owner_delete_requests"))
    logger.info("PROJ-64: owner_delete_requests (PROJ-48-Stub) gedroppt ✓")
