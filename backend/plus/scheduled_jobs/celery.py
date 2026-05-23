# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-70: Celery-Tasks für Scheduled Jobs (Plus-Modul).

Beat-Schedule + Dispatcher-Task + Ausführungs-Task wurden aus backend/celery_app.py
hierher migriert. Registrierung via register_tasks(celery_app) auf Einladung von
ScheduledJobsPlusBehavior.register_scheduled_job_celery_tasks().

Tasks werden INNERHALB von register_tasks() dekoriert um Circular-Import-Probleme
zwischen celery_app.py und backend.plus.scheduled_jobs.celery zu vermeiden.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


def register_tasks(celery_app) -> None:
    """Registriert Beat-Schedule und Task-Definitionen am übergebenen Celery-App-Objekt.

    Tasks werden hier dekoriert (nicht auf Modul-Level) um Circular-Imports zu vermeiden.
    """
    # Beat-Schedule eintragen
    celery_app.conf.beat_schedule["dispatch-scheduled-jobs-every-minute"] = {
        "task": "backend.plus.scheduled_jobs.celery.dispatch_scheduled_jobs",
        "schedule": 60.0,
    }

    # ── Dispatcher-Task ───────────────────────────────────────────────────────

    @celery_app.task(name="backend.plus.scheduled_jobs.celery.dispatch_scheduled_jobs", bind=False)
    def _dispatch_scheduled_jobs() -> None:
        """Liest fällige Jobs und stellt Ausführungs-Tasks in die Queue."""
        asyncio.run(_async_dispatch())

    # ── Ausführungs-Task ──────────────────────────────────────────────────────

    @celery_app.task(name="backend.plus.scheduled_jobs.celery.execute_scheduled_job", bind=False)
    def _execute_scheduled_job(job_id: str, triggered_by: str = "scheduler") -> None:
        """Führt einen einzelnen Scheduled Job aus."""
        from backend.plus.scheduled_jobs.runner import run_job
        run_job(job_id, triggered_by)

    # Globale Referenz für den Dispatcher, damit er execute_scheduled_job.delay() aufrufen kann
    global _execute_task_ref
    _execute_task_ref = _execute_scheduled_job

    logger.info("PROJ-70: Scheduled-Job-Celery-Tasks im Beat-Schedule registriert")


# ── Modul-Level-Referenz für execute-Task (gesetzt von register_tasks) ───────
_execute_task_ref = None


async def _async_dispatch() -> None:
    from backend.db.database import init_db
    await init_db()

    from backend.plus.scheduled_jobs.service import advance_next_run, get_due_jobs
    from backend.core.plus_protocol import plus_behavior

    due = await get_due_jobs()
    logger.info("Dispatcher: %d fällige Jobs gefunden", len(due))

    # PROJ-64: Approval-blockierte Jobs herausfiltern
    if due:
        candidate_ids = {job["id"] for job in due}
        try:
            blocked = await plus_behavior.get_approval_blocked_scheduled_job_ids(candidate_ids)
        except Exception:
            blocked = set()
        due = [job for job in due if job["id"] not in blocked]
        if blocked:
            logger.info("Dispatcher: %d Jobs wegen Approval-Status übersprungen", len(blocked))

    for job in due:
        job_id = job["id"]
        cron = job["cron_expression"]
        await advance_next_run(job_id, cron)
        if _execute_task_ref is not None:
            _execute_task_ref.delay(job_id, "scheduler")
        logger.info("Dispatcher: Job %s (%s) eingereiht", job_id, job.get("name"))
