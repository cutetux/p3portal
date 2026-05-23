# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-35: CRUD, Dispatcher-Logik und History-Management für Scheduled Jobs."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from croniter import croniter
from sqlalchemy import text

from backend.db.database import get_db


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now().isoformat()


def _compute_next_run(cron_expression: str, after: datetime | None = None) -> str | None:
    """Berechnet den nächsten Ausführungszeitpunkt via croniter (lokale Zeit, respektiert TZ)."""
    try:
        base = after or datetime.now()
        it = croniter(cron_expression, base)
        next_dt: datetime = it.get_next(datetime)
        return next_dt.isoformat()
    except Exception:
        return None


def _row_to_dict(row) -> dict:
    return dict(row)


async def _get_history_limit() -> int:
    from backend.services.settings_service import get_setting
    val = await get_setting("scheduled_jobs.history_limit")
    try:
        return max(1, int(val)) if val else 20
    except (ValueError, TypeError):
        return 20


# ── Job-CRUD ──────────────────────────────────────────────────────────────────

async def list_jobs(username: str, is_admin: bool) -> list[dict]:
    """Gibt alle Jobs zurück (Admin) oder nur eigene (normaler Nutzer).

    Parent-Jobs (parent_job_id IS NULL) werden mit eingebettetem Child zurückgegeben.
    """
    async with get_db() as session:
        if is_admin:
            result = await session.execute(
                text("SELECT * FROM scheduled_jobs WHERE parent_job_id IS NULL ORDER BY created_at DESC")
            )
        else:
            result = await session.execute(
                text(
                    "SELECT * FROM scheduled_jobs WHERE parent_job_id IS NULL AND created_by = :u "
                    "ORDER BY created_at DESC"
                ),
                {"u": username},
            )
        parents = [_row_to_dict(r) for r in result.mappings().all()]

    # Child-Jobs einbetten
    for parent in parents:
        parent["config"] = json.loads(parent.get("config") or "{}")
        parent["child_job"] = await _get_child(parent["id"])

    return parents


async def _get_child(parent_id: str) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM scheduled_jobs WHERE parent_job_id = :pid"),
            {"pid": parent_id},
        )
        row = result.mappings().fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    d["config"] = json.loads(d.get("config") or "{}")
    return d


async def get_job(job_id: str) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM scheduled_jobs WHERE id = :id"),
            {"id": job_id},
        )
        row = result.mappings().fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    d["config"] = json.loads(d.get("config") or "{}")
    d["child_job"] = await _get_child(job_id)
    return d


async def count_jobs_by_user(username: str) -> int:
    """Zählt aktive Parent-Jobs (parent_job_id IS NULL) eines Nutzers für Limit-Enforcement."""
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM scheduled_jobs "
                "WHERE created_by = :u AND parent_job_id IS NULL"
            ),
            {"u": username},
        )
        return result.scalar() or 0


async def create_job(
    name: str,
    job_type: str,
    cron_expression: str,
    config: dict[str, Any],
    created_by: str,
    description: str | None = None,
    active: bool = True,
    parent_job_id: str | None = None,
) -> dict:
    job_id = str(uuid.uuid4())
    now = _now()
    next_run = _compute_next_run(cron_expression) if active else None

    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO scheduled_jobs
                   (id, name, description, job_type, cron_expression, active, config,
                    created_by, created_at, updated_at, next_run_at, parent_job_id)
                   VALUES (:id, :name, :desc, :type, :cron, :active, :config,
                           :by, :now, :now, :next, :parent)"""
            ),
            {
                "id": job_id,
                "name": name,
                "desc": description,
                "type": job_type,
                "cron": cron_expression,
                "active": 1 if active else 0,
                "config": json.dumps(config),
                "by": created_by,
                "now": now,
                "next": next_run,
                "parent": parent_job_id,
            },
        )
        await session.commit()

    return await get_job(job_id)  # type: ignore[return-value]


async def update_job(
    job_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    cron_expression: str | None = None,
    active: bool | None = None,
    config: dict[str, Any] | None = None,
) -> dict | None:
    job = await get_job(job_id)
    if not job:
        return None

    now = _now()
    new_cron = cron_expression if cron_expression is not None else job["cron_expression"]
    new_active = active if active is not None else bool(job["active"])
    next_run = _compute_next_run(new_cron) if new_active else None

    async with get_db() as session:
        await session.execute(
            text(
                """UPDATE scheduled_jobs SET
                   name            = COALESCE(:name, name),
                   description     = CASE WHEN :desc_set THEN :desc ELSE description END,
                   cron_expression = COALESCE(:cron, cron_expression),
                   active          = COALESCE(:active, active),
                   config          = COALESCE(:config, config),
                   updated_at      = :now,
                   next_run_at     = :next
                   WHERE id = :id"""
            ),
            {
                "name": name,
                "desc_set": description is not None,
                "desc": description,
                "cron": cron_expression,
                "active": (1 if active else 0) if active is not None else None,
                "config": json.dumps(config) if config is not None else None,
                "now": now,
                "next": next_run,
                "id": job_id,
            },
        )
        await session.commit()

    return await get_job(job_id)


async def delete_job(job_id: str) -> bool:
    """Löscht Job + alle Runs (CASCADE) + Child-Jobs (CASCADE)."""
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM scheduled_jobs WHERE id = :id AND parent_job_id IS NULL"),
            {"id": job_id},
        )
        await session.commit()
        return result.rowcount > 0


async def toggle_job(job_id: str) -> dict | None:
    job = await get_job(job_id)
    if not job:
        return None
    new_active = not bool(job["active"])
    next_run = _compute_next_run(job["cron_expression"]) if new_active else None
    now = _now()

    async with get_db() as session:
        await session.execute(
            text("UPDATE scheduled_jobs SET active = :a, next_run_at = :next, updated_at = :now WHERE id = :id"),
            {"a": 1 if new_active else 0, "next": next_run, "now": now, "id": job_id},
        )
        # Child-Job ebenfalls umschalten (Zeitfenster-Modus)
        await session.execute(
            text("UPDATE scheduled_jobs SET active = :a, next_run_at = :next, updated_at = :now WHERE parent_job_id = :id"),
            {"a": 1 if new_active else 0, "next": next_run, "now": now, "id": job_id},
        )
        await session.commit()

    return await get_job(job_id)


# ── Dispatcher-Logik ──────────────────────────────────────────────────────────

async def get_due_jobs() -> list[dict]:
    """Gibt alle aktiven Jobs zurück, deren next_run_at in der Vergangenheit liegt
    und die gerade nicht laufen (Overlap-Schutz).
    """
    now = _now()
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT * FROM scheduled_jobs
                   WHERE active = 1
                     AND next_run_at IS NOT NULL
                     AND next_run_at <= :now
                     AND (last_run_status IS NULL OR last_run_status != 'running')
                   ORDER BY next_run_at ASC"""
            ),
            {"now": now},
        )
        rows = [_row_to_dict(r) for r in result.mappings().all()]

    for r in rows:
        r["config"] = json.loads(r.get("config") or "{}")
    return rows


async def advance_next_run(job_id: str, cron_expression: str) -> None:
    """Berechnet next_run_at neu und setzt last_run_status=running."""
    next_run = _compute_next_run(cron_expression)
    now = _now()
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE scheduled_jobs SET next_run_at = :next, last_run_status = 'running', "
                "last_run_at = :now WHERE id = :id"
            ),
            {"next": next_run, "now": now, "id": job_id},
        )
        await session.commit()


# ── Run-CRUD ──────────────────────────────────────────────────────────────────

async def create_run(job_id: str, triggered_by: str, action: str | None = None) -> str:
    """Legt einen neuen Run-Eintrag an und gibt die Run-ID zurück."""
    run_id = str(uuid.uuid4())
    now = _now()
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO scheduled_job_runs
                   (id, job_id, started_at, status, triggered_by, action)
                   VALUES (:id, :job, :now, 'running', :by, :action)"""
            ),
            {"id": run_id, "job": job_id, "now": now, "by": triggered_by, "action": action},
        )
        await session.commit()
    return run_id


async def finish_run(
    run_id: str,
    job_id: str,
    output: str,
    exit_code: int,
) -> None:
    """Schließt einen Run ab und aktualisiert last_run_status am Job."""
    status = "success" if exit_code == 0 else "failed"
    now = _now()
    limit = await _get_history_limit()

    async with get_db() as session:
        await session.execute(
            text(
                """UPDATE scheduled_job_runs
                   SET finished_at = :now, status = :status, exit_code = :code,
                       output = :out
                   WHERE id = :id"""
            ),
            {"now": now, "status": status, "code": exit_code, "out": output[:51200], "id": run_id},
        )
        await session.execute(
            text(
                "UPDATE scheduled_jobs SET last_run_at = :now, last_run_status = :status WHERE id = :id"
            ),
            {"now": now, "status": status, "id": job_id},
        )
        # History-Limit durchsetzen
        await session.execute(
            text(
                """DELETE FROM scheduled_job_runs WHERE job_id = :jid
                   AND id NOT IN (
                       SELECT id FROM scheduled_job_runs WHERE job_id = :jid
                       ORDER BY started_at DESC LIMIT :lim
                   )"""
            ),
            {"jid": job_id, "lim": limit},
        )
        await session.commit()


async def fail_run(run_id: str, job_id: str, error_msg: str) -> None:
    """Markiert einen Run als fehlgeschlagen (Exception im Runner)."""
    await finish_run(run_id, job_id, f"[runner error] {error_msg}", exit_code=1)


async def get_runs(job_id: str) -> list[dict]:
    limit = await _get_history_limit()
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT * FROM scheduled_job_runs WHERE job_id = :id "
                "ORDER BY started_at DESC LIMIT :lim"
            ),
            {"id": job_id, "lim": limit},
        )
        return [_row_to_dict(r) for r in result.mappings().all()]


# ── Settings ──────────────────────────────────────────────────────────────────

async def get_settings() -> dict:
    from backend.services.settings_service import get_setting
    from backend.services.config_service import get_config
    history_limit = await _get_history_limit()
    system_key = await get_config("scheduled_jobs.system_ssh_key")
    return {
        "history_limit": history_limit,
        "has_system_ssh_key": bool(system_key and system_key.strip()),
    }


async def set_history_limit(limit: int, updated_by: str) -> None:
    from backend.services.settings_service import set_setting
    await set_setting("scheduled_jobs.history_limit", str(limit), updated_by)
    # History sofort kürzen für alle Jobs wenn Limit verringert wurde
    async with get_db() as session:
        result = await session.execute(text("SELECT DISTINCT job_id FROM scheduled_job_runs"))
        job_ids = [r[0] for r in result.all()]
        for jid in job_ids:
            await session.execute(
                text(
                    """DELETE FROM scheduled_job_runs WHERE job_id = :jid
                       AND id NOT IN (
                           SELECT id FROM scheduled_job_runs WHERE job_id = :jid
                           ORDER BY started_at DESC LIMIT :lim
                       )"""
                ),
                {"jid": jid, "lim": limit},
            )
        await session.commit()


async def set_system_ssh_key(key: str, updated_by: str) -> None:
    from backend.services.config_service import set_config
    await set_config("scheduled_jobs.system_ssh_key", key, is_secret=True, updated_by=updated_by)


async def delete_system_ssh_key() -> None:
    async with get_db() as session:
        await session.execute(
            text("DELETE FROM portal_config WHERE key = 'scheduled_jobs.system_ssh_key'")
        )
        await session.commit()


async def get_system_ssh_key() -> str | None:
    from backend.services.config_service import get_config
    val = await get_config("scheduled_jobs.system_ssh_key")
    return val if val and val.strip() else None
