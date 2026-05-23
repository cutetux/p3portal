# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Celery-Beat-Task – abgelaufene Anträge bereinigen."""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


def register_tasks(celery_app) -> None:  # noqa: ANN001
    """Registriert den expire_overdue-Task an der Celery-App."""

    @celery_app.task(name="backend.plus.approvals.tasks.expire_overdue", bind=False)
    def expire_overdue() -> None:
        asyncio.run(_async_expire())

    celery_app.conf.beat_schedule["expire-overdue-approvals-hourly"] = {
        "task": "backend.plus.approvals.tasks.expire_overdue",
        "schedule": 3600.0,
    }


async def _async_expire() -> None:
    from backend.db.database import init_db
    await init_db()

    from backend.plus.approvals.service import expire_overdue_approvals
    count = await expire_overdue_approvals()
    logger.info("PROJ-50: expire_overdue: %d Anträge abgelaufen", count)
