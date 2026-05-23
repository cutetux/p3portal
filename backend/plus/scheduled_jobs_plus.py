# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Scheduled-Jobs-Plus-Mixin.

Implementiert alle 6 Scheduled-Jobs-Hooks für die Plus-Edition.
Delegiert an Sub-Services in backend/plus/scheduled_jobs/.

Import-Richtung: Plus → Core (OK), Core → Plus (verboten).
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class ScheduledJobsPlusBehavior:
    """Plus-Mixin: vollständige Scheduled-Jobs-Implementierung (PROJ-70)."""

    def get_max_scheduled_jobs_per_user(self) -> int | None:
        from backend.core.license import CORE_MAX_SCHEDULED_JOBS_PER_USER, is_plus_edition
        return None if is_plus_edition() else CORE_MAX_SCHEDULED_JOBS_PER_USER

    # ── Runner-Start ──────────────────────────────────────────────────────────

    async def start_scheduled_job_runner(self) -> None:
        """Startet den Asyncio-Runner-Loop als fire-and-forget Task.

        Wird im Lifespan von main.py nach ensure_plus_db_tables() aufgerufen.
        Kein Celery vorhanden → Asyncio-Fallback (Pure-Plus ohne Valkey).
        """
        try:
            import asyncio
            from backend.plus.scheduled_jobs.runner import _runner_loop
            asyncio.create_task(_runner_loop(), name="scheduled_job_runner")
            logger.info("PROJ-70: Scheduled-Job-Runner gestartet")
        except Exception as exc:
            logger.warning("PROJ-70: start_scheduled_job_runner fehlgeschlagen: %s", exc)

    # ── Celery-Registrierung ──────────────────────────────────────────────────

    def register_scheduled_job_celery_tasks(self, celery_app) -> None:
        """Registriert Beat-Schedule + Tasks für Scheduled Jobs am Celery-App-Objekt.

        Wird von backend/celery_app.py nach Erstellung der Celery-App aufgerufen.
        """
        try:
            from backend.plus.scheduled_jobs.celery import register_tasks
            register_tasks(celery_app)
            logger.info("PROJ-70: Scheduled-Job-Celery-Tasks registriert")
        except Exception as exc:
            logger.warning("PROJ-70: register_scheduled_job_celery_tasks fehlgeschlagen: %s", exc)

    # ── Action-Handler-Registry ───────────────────────────────────────────────

    def get_scheduled_job_action_handlers(self) -> dict:
        """Lazy-baut Dict {job_type: handler_fn}.

        Jeder Handler ist eine Callable mit Signatur
        ``async (job: dict, config: dict) -> tuple[str, int]``.
        """
        try:
            from backend.plus.scheduled_jobs.runner import (
                _run_ssh,
                _run_playbook,
                _run_power_action,
                _run_git_sync,
            )
            return {
                "ssh": _run_ssh,
                "playbook": _run_playbook,
                "power_action": _run_power_action,
                "git_sync": _run_git_sync,
            }
        except Exception as exc:
            logger.warning("PROJ-70: get_scheduled_job_action_handlers fehlgeschlagen: %s", exc)
            return {}

    # ── Cleanup-Hooks ─────────────────────────────────────────────────────────

    async def on_user_deleted_scheduled_jobs(self, user_id: int, actor_username: str) -> int:
        """Löscht alle Scheduled Jobs eines gelöschten Nutzers (Cleanup-Hook PROJ-70).

        Returns Anzahl gelöschter Jobs.
        """
        try:
            from backend.db.database import get_db
            from sqlalchemy import text

            # username für die Query ermitteln
            async with get_db() as session:
                result = await session.execute(
                    text("SELECT username FROM local_users WHERE id = :uid"),
                    {"uid": user_id},
                )
                row = result.fetchone()
                username = row[0] if row else None

            if not username:
                return 0

            async with get_db() as session:
                result = await session.execute(
                    text("DELETE FROM scheduled_jobs WHERE created_by = :u AND parent_job_id IS NULL"),
                    {"u": username},
                )
                await session.commit()
                count = result.rowcount

            if count:
                from backend.services.audit_service import write_audit_log
                import json
                await write_audit_log(
                    "scheduled_jobs_bulk_deleted",
                    username=actor_username,
                    detail=json.dumps({
                        "reason": "user_deleted",
                        "deleted_username": username,
                        "count": count,
                    }),
                )
                logger.info("PROJ-70: %d Scheduled Jobs von User %s gelöscht (User-Delete)", count, username)

            return count
        except Exception as exc:
            logger.warning("PROJ-70: on_user_deleted_scheduled_jobs fehlgeschlagen: %s", exc)
            return 0

    async def on_playbook_deleted_scheduled_jobs(self, playbook_name: str, actor_username: str) -> int:
        """Deaktiviert alle Scheduled Jobs, die ein gelöschtes Playbook referenzieren.

        Returns Anzahl deaktivierter Jobs.
        """
        try:
            from backend.db.database import get_db
            from sqlalchemy import text
            import json
            from datetime import datetime

            # JSON-Feld config enthält "playbook": "<name>" – LIKE-Suche als Vorfilter,
            # dann serverseitiger Exakt-Abgleich um False-Positives zu vermeiden.
            now = datetime.now().isoformat()
            async with get_db() as session:
                result = await session.execute(
                    text(
                        "SELECT id, config FROM scheduled_jobs "
                        "WHERE job_type = 'playbook' AND active = 1 "
                        "  AND config LIKE :pattern"
                    ),
                    {"pattern": f'%"{playbook_name}"%'},
                )
                candidates = [(r[0], r[1]) for r in result.all()]

            # Exakten Abgleich serverseitig
            to_deactivate = [
                jid for jid, cfg_str in candidates
                if json.loads(cfg_str or "{}").get("playbook") == playbook_name
            ]

            if not to_deactivate:
                return 0

            async with get_db() as session:
                for jid in to_deactivate:
                    await session.execute(
                        text(
                            "UPDATE scheduled_jobs SET active = 0, next_run_at = NULL, "
                            "updated_at = :now WHERE id = :id"
                        ),
                        {"now": now, "id": jid},
                    )
                await session.commit()

            from backend.services.audit_service import write_audit_log
            await write_audit_log(
                "scheduled_jobs_bulk_deactivated",
                username=actor_username,
                detail=json.dumps({
                    "reason": "playbook_deleted",
                    "playbook_name": playbook_name,
                    "count": len(to_deactivate),
                }),
            )
            logger.info(
                "PROJ-70: %d Scheduled Jobs wegen gelöschtem Playbook '%s' deaktiviert",
                len(to_deactivate), playbook_name,
            )
            return len(to_deactivate)
        except Exception as exc:
            logger.warning("PROJ-70: on_playbook_deleted_scheduled_jobs fehlgeschlagen: %s", exc)
            return 0

    async def on_node_deleted_scheduled_jobs(self, node_id, actor_username: str) -> int:
        """Löscht alle Compute-Node-gebundenen Scheduled Jobs eines gelöschten Nodes.

        Betrifft power_action-Jobs (config.node) und playbook-Jobs (config.params.proxmox_node).
        Returns Anzahl gelöschter Jobs.
        """
        try:
            from backend.db.database import get_db
            from sqlalchemy import text
            import json

            async with get_db() as session:
                result = await session.execute(
                    text(
                        "SELECT id, job_type, config FROM scheduled_jobs "
                        "WHERE parent_job_id IS NULL AND job_type IN ('power_action', 'playbook')"
                    )
                )
                candidates = [(r[0], r[1], r[2]) for r in result.all()]

            to_delete: list[str] = []
            for jid, jtype, cfg_str in candidates:
                cfg = json.loads(cfg_str or "{}")
                if jtype == "power_action" and str(cfg.get("node", "")) == str(node_id):
                    to_delete.append(jid)
                elif jtype == "playbook":
                    params = cfg.get("params", {})
                    if str(params.get("proxmox_node", "")) == str(node_id):
                        to_delete.append(jid)

            if not to_delete:
                return 0

            async with get_db() as session:
                for jid in to_delete:
                    await session.execute(
                        text("DELETE FROM scheduled_jobs WHERE id = :id AND parent_job_id IS NULL"),
                        {"id": jid},
                    )
                await session.commit()

            from backend.services.audit_service import write_audit_log
            await write_audit_log(
                "scheduled_jobs_bulk_deleted",
                username=actor_username,
                detail=json.dumps({
                    "reason": "node_deleted",
                    "node_id": str(node_id),
                    "count": len(to_delete),
                }),
            )
            logger.info(
                "PROJ-70: %d Scheduled Jobs wegen gelöschtem Node '%s' gelöscht",
                len(to_delete), node_id,
            )
            return len(to_delete)
        except Exception as exc:
            logger.warning("PROJ-70: on_node_deleted_scheduled_jobs fehlgeschlagen: %s", exc)
            return 0
