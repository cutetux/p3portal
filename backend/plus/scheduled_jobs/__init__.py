# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Scheduled-Jobs-Plus-Modul.

Enthält ensure_plus_db_tables(): DDL-Sicherstellung für scheduled_jobs + scheduled_job_runs.

Da die Tabellennamen identisch zu den bisherigen Core-Tabellen sind, werden bei
Upgrade-Installationen keine Daten migriert. create_all(checkfirst=True) ist idempotent.

Neue Installationen erhalten die Plus-Tabellen über diesen Aufruf, da die Core-
Tabellendefinitionen aus backend/db/models.py entfernt wurden.
"""
from __future__ import annotations

import logging

from .router import router, settings_router

logger = logging.getLogger(__name__)

__all__ = ["router", "settings_router", "ensure_plus_db_tables"]


def ensure_plus_db_tables(engine) -> None:
    """Erstellt scheduled_jobs + scheduled_job_runs idempotent (IF NOT EXISTS).

    Wird von plus/__init__.py::ensure_plus_db_tables() aufgerufen,
    BEVOR der PROJ-64-Approval-Migrations-Block läuft (Reihenfolge entscheidend:
    scheduled_job_approval_status.scheduled_job_id referenziert scheduled_jobs.id).
    """
    from .models import plus_metadata
    from sqlalchemy import text

    try:
        # DDL: Tabellen anlegen falls nicht vorhanden (Phantome werden übersprungen)
        plus_metadata.create_all(engine, checkfirst=True)
        logger.debug("PROJ-70: scheduled_jobs / scheduled_job_runs sichergestellt (DDL)")
    except Exception as exc:
        logger.error("PROJ-70: DDL create_all fehlgeschlagen: %s", exc)
        return

    # Idempotenz-Log: Tabellen-Existenz bestätigen
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'")
            ).fetchone()
            if row:
                logger.debug("PROJ-70: scheduled_jobs-Tabelle vorhanden ✓")
            else:
                logger.warning("PROJ-70: scheduled_jobs-Tabelle fehlt trotz create_all – prüfen!")
    except Exception as exc:
        logger.warning("PROJ-70: Existenz-Check fehlgeschlagen: %s", exc)
