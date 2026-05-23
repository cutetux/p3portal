# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Git-Sync für Playbooks & Packer-Templates."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def ensure_plus_db_tables(engine) -> None:
    """Erstellt alle git_sync-Tabellen idempotent (IF NOT EXISTS-Semantik)."""
    try:
        from backend.plus.git_sync.models import plus_metadata as _meta
        _meta.create_all(engine, checkfirst=True)
        logger.debug("PROJ-68: git_sync-Tabellen sichergestellt")
    except Exception as exc:
        logger.warning("PROJ-68: git_sync create_all fehlgeschlagen: %s", exc)
