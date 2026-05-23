# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-60: Plus-Selbstregistrierung beim Core.

Dieses Modul wird exklusiv von `backend/main.py` importiert (try/except).
Es registriert `PlusActiveBehavior` via `set_plus_behavior()` beim Core-Dispatcher.
Community-Code importiert niemals direkt aus `backend.plus`.

Fail-safe: Fehlt `backend/plus/` komplett (Pure-Core-Build), schlägt der
Import fehl → Dispatcher bleibt bei CorePlusBehavior. Kein Fehler, kein Crash.
"""
from __future__ import annotations

import logging

from backend.core.plus_protocol import (
    CorePlusBehavior,
    set_plus_behavior,
)

logger = logging.getLogger(__name__)

# ── Mixin-Importe (jeder einzeln abgesichert für Edge Case 2) ───────────────

_mixins: list[type] = []

try:
    from backend.plus.alerts_plus import AlertsPlusBehavior
    _mixins.append(AlertsPlusBehavior)
except ImportError:
    logger.warning("alerts_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.approvals_plus import ApprovalsPlusBehavior
    _mixins.append(ApprovalsPlusBehavior)
except ImportError:
    logger.warning("approvals_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.cluster_plus import ClusterPlusBehavior
    _mixins.append(ClusterPlusBehavior)
except ImportError:
    logger.warning("cluster_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.help_plus import HelpPlusBehavior
    _mixins.append(HelpPlusBehavior)
except ImportError:
    logger.warning("help_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.misc_plus import MiscPlusBehavior
    _mixins.append(MiscPlusBehavior)
except ImportError:
    logger.warning("misc_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.nodes_plus import NodesPlusBehavior
    _mixins.append(NodesPlusBehavior)
except ImportError:
    logger.warning("nodes_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.owners_plus import OwnersPlusBehavior
    _mixins.append(OwnersPlusBehavior)
except ImportError:
    logger.warning("owners_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.playbook_permissions_plus import PlaybookPermissionsPlusBehavior
    _mixins.append(PlaybookPermissionsPlusBehavior)
except ImportError:
    logger.warning("playbook_permissions_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.pools_plus import PoolsPlusBehavior
    _mixins.append(PoolsPlusBehavior)
except ImportError:
    logger.warning("pools_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.packer_plus import PackerPlusBehavior
    _mixins.append(PackerPlusBehavior)
except ImportError:
    logger.warning("packer_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.themes_plus import ThemesPlusBehavior
    _mixins.append(ThemesPlusBehavior)
except ImportError:
    logger.warning("themes_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.git_sync_plus import GitSyncPlusBehavior
    _mixins.append(GitSyncPlusBehavior)
except ImportError:
    logger.warning("git_sync_plus nicht verfügbar – Core-Defaults aktiv")

try:
    from backend.plus.scheduled_jobs_plus import ScheduledJobsPlusBehavior
    _mixins.append(ScheduledJobsPlusBehavior)
except ImportError:
    logger.warning("scheduled_jobs_plus nicht verfügbar – Core-Defaults aktiv")


# ── Plus-Capability-Gate-Hooks ohne dediziertes Mixin ───────────────────────

class _PlusGateBehavior:
    """Gate-Hooks, die in keinem spezifischen *_plus.py-Mixin leben."""

    def can_use_scheduled_jobs(self) -> bool:
        return True

    def can_use_alerts_smtp(self) -> bool:
        return True

    def can_use_api_key_max_count_override(self) -> bool:
        return True

    def can_use_api_key_scopes_full(self) -> bool:
        return True

    def can_use_sidebar_pins_extended(self) -> bool:
        return True

    def can_use_compute_alerting(self) -> bool:
        return True

    def can_use_compute_scheduled_jobs(self) -> bool:
        return True

    def can_use_approval_workflow(self) -> bool:
        return True

    def can_use_help_global_overrides(self) -> bool:
        return True

    def can_use_playbook_permissions(self) -> bool:
        return True

    def can_use_pools_quotas(self) -> bool:
        return True

    def can_use_groups_unlimited(self) -> bool:
        return True

    def get_extra_portal_permissions(self) -> list[str]:
        return ["manage_pools", "manage_playbook_permissions", "approve_jobs"]

    def can_use_node_assignments(self) -> bool:
        return True

    def can_use_owners_unlimited(self) -> bool:
        return True

    def ensure_plus_db_tables(self) -> None:
        """Erstellt alle Plus-Tabellen idempotent (IF NOT EXISTS-Semantik).

        Wird vom main.py-Lifespan NACH init_db() aufgerufen, um Timing-Probleme
        beim Erststart zu vermeiden (PROJ-63 BUG-63-2):
        backend/plus/__init__ läuft ggf. vor init_db(), wenn ein Plus-Submodul
        als Router-Import den Package-Init triggert. Zu diesem Zeitpunkt ist
        get_sync_engine() noch None → create_all() würde übersprungen.
        Dieser Hook stellt sicher, dass die Tabellen nach init_db() angelegt werden.
        """
        from backend.db.database import get_sync_engine as _gse
        _engine = _gse()
        if _engine is None:
            logger.warning("ensure_plus_db_tables: Engine noch None – Tabellen nicht angelegt")
            return

        # PROJ-62: Pool-Tabellen
        try:
            from backend.plus.pools.models import plus_metadata as _pools_meta
            _pools_meta.create_all(_engine, checkfirst=True)
            logger.debug("PROJ-62: Pool-Tabellen sichergestellt (ensure_plus_db_tables)")
        except Exception as _e:
            logger.warning("PROJ-62: Pool-Tabellen create_all fehlgeschlagen: %s", _e)

        # PROJ-63: Playbook-Permission-Tabellen + One-Shot-Migration
        try:
            from backend.plus.playbook_permissions.models import (
                plus_metadata as _pp_meta,
                _migrate_default_mode,
            )
            _pp_meta.create_all(_engine, checkfirst=True)
            _migrate_default_mode(_engine)
            logger.debug("PROJ-63: Playbook-Permission-Tabellen + Migration sichergestellt")
        except Exception as _e:
            logger.warning("PROJ-63: Playbook-Permission create_all fehlgeschlagen: %s", _e)

        # PROJ-70: Scheduled-Jobs-Tabellen (VOR PROJ-64 – FK-Reihenfolge!)
        # scheduled_job_approval_status.scheduled_job_id referenziert scheduled_jobs.id
        try:
            from backend.plus.scheduled_jobs import ensure_plus_db_tables as _sj_migrate
            _sj_migrate(_engine)
            logger.debug("PROJ-70: scheduled_jobs-Tabellen sichergestellt")
        except Exception as _e:
            logger.warning("PROJ-70: scheduled_jobs ensure_plus_db_tables fehlgeschlagen: %s", _e)

        # PROJ-64: Approval-Workflow-Tabellen + One-Shot-Datenmigration
        try:
            from backend.plus.approvals import ensure_plus_db_tables as _approvals_migrate
            _approvals_migrate(_engine)
            logger.debug("PROJ-64: Approval-Workflow-Tabellen + Migration sichergestellt")
        except Exception as _e:
            logger.warning("PROJ-64: Approval-Workflow ensure_plus_db_tables fehlgeschlagen: %s", _e)

        # PROJ-68: Git-Sync-Tabellen
        try:
            from backend.plus.git_sync import ensure_plus_db_tables as _git_sync_migrate
            _git_sync_migrate(_engine)
            logger.debug("PROJ-68: git_sync-Tabellen sichergestellt")
        except Exception as _e:
            logger.warning("PROJ-68: git_sync ensure_plus_db_tables fehlgeschlagen: %s", _e)


# ── PlusActiveBehavior: dynamisch aus verfügbaren Mixins komponiert ─────────

PlusActiveBehavior = type(
    "PlusActiveBehavior",
    tuple([_PlusGateBehavior, *_mixins, CorePlusBehavior]),
    {},
)

# ── Registrierung beim Core-Dispatcher ──────────────────────────────────────

set_plus_behavior(PlusActiveBehavior())

# ── Hinweis: Plus-Tabellen werden via ensure_plus_db_tables() angelegt ───────
# main.py ruft plus_behavior.ensure_plus_db_tables() im Lifespan NACH init_db() auf.
# Das löst den Timing-Bug (PROJ-63 BUG-63-2): Frühere create_all()-Aufrufe hier
# schlugen auf Erstinstallationen fehl, weil get_sync_engine() noch None war.
