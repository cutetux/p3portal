# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-64: Bulk-Filter-Hook für Scheduled-Job-Runner.

get_approval_blocked_scheduled_job_ids() liest aus scheduled_job_approval_status
und gibt IDs zurück, die nicht ausgeführt werden dürfen (pending_approval/suspended).

Kein Cross-Schema-JOIN notwendig: der Runner fragt nur die Plus-Tabelle ab.
"""
from __future__ import annotations

from sqlalchemy import text

from backend.db.database import get_db


async def get_approval_blocked_scheduled_job_ids(candidate_ids: set[str]) -> set[str]:
    """Gibt die Subset von candidate_ids zurück, die in scheduled_job_approval_status blockiert sind.

    Wird vom Scheduled-Job-Tick-Runner NACH get_due_jobs() aufgerufen, um
    approval-blockierte Jobs aus der Ausführungsqueue zu filtern.
    """
    if not candidate_ids:
        return set()

    placeholders = ", ".join(f":id{i}" for i in range(len(candidate_ids)))
    params = {f"id{i}": jid for i, jid in enumerate(candidate_ids)}

    async with get_db() as db:
        result = await db.execute(
            text(f"""
                SELECT scheduled_job_id
                  FROM scheduled_job_approval_status
                 WHERE scheduled_job_id IN ({placeholders})
                   AND status IN ('pending_approval', 'suspended')
            """),
            params,
        )
        rows = result.fetchall()

    return {r[0] for r in rows}
