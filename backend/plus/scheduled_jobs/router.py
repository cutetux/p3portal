# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-35: REST-Endpunkte für Scheduled Jobs."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.core.plus_protocol import plus_behavior
from backend.models.scheduled_jobs import (
    HistoryLimitRequest,
    ScheduledJobChildResponse,
    ScheduledJobCreateRequest,
    ScheduledJobResponse,
    ScheduledJobRunResponse,
    ScheduledJobsSettingsResponse,
    ScheduledJobUpdateRequest,
    SystemSshKeyRequest,
)
from backend.plus.scheduled_jobs import service as svc

router = APIRouter(prefix="/api/scheduled-jobs", tags=["scheduled-jobs"])
settings_router = APIRouter(prefix="/api/admin/scheduled-jobs", tags=["admin"])

# Alle user-facing Endpoints nutzen get_current_user;
# _check_ownership() im Service übernimmt die Eigentumsautorisation.
# manage_scheduled_jobs ist keine assignierbare UI-Berechtigung → admin_or wäre de facto admin-only.


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(d: dict) -> ScheduledJobResponse:
    child = None
    if d.get("child_job"):
        c = d["child_job"]
        child = ScheduledJobChildResponse(
            id=c["id"],
            cron_expression=c["cron_expression"],
            config=c["config"] if isinstance(c["config"], dict) else json.loads(c["config"] or "{}"),
            last_run_at=c.get("last_run_at"),
            last_run_status=c.get("last_run_status"),
            next_run_at=c.get("next_run_at"),
        )
    cfg = d.get("config", {})
    if isinstance(cfg, str):
        cfg = json.loads(cfg or "{}")
    return ScheduledJobResponse(
        id=d["id"],
        name=d["name"],
        description=d.get("description"),
        job_type=d["job_type"],
        cron_expression=d["cron_expression"],
        active=bool(d.get("active", 1)),
        config=cfg,
        created_by=d["created_by"],
        created_at=d["created_at"],
        updated_at=d["updated_at"],
        last_run_at=d.get("last_run_at"),
        last_run_status=d.get("last_run_status"),
        next_run_at=d.get("next_run_at"),
        child_job=child,
    )


def _check_ownership(job: dict, current_user: CurrentUser) -> None:
    """Prüft ob der Nutzer Zugriff auf diesen Job hat."""
    if current_user.role == "admin":
        return
    if job["created_by"] != current_user.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Kein Zugriff auf diesen Job")


# ── Liste ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ScheduledJobResponse])
async def list_jobs(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ScheduledJobResponse]:
    is_admin = current_user.role == "admin"
    jobs = await svc.list_jobs(current_user.username, is_admin)
    return [_to_response(j) for j in jobs]


# ── Erstellen ─────────────────────────────────────────────────────────────────

@router.post("", response_model=ScheduledJobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: ScheduledJobCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> ScheduledJobResponse:
    # Core-Edition-Limit: 3 Jobs pro Nutzer (parent_job_id IS NULL)
    max_sj = plus_behavior.get_max_scheduled_jobs_per_user()
    if max_sj is not None:
        current_count = await svc.count_jobs_by_user(current_user.username)
        if current_count >= max_sj:
            raise HTTPException(
                status_code=status.HTTP_412_PRECONDITION_FAILED,
                detail="scheduled_jobs_limit_reached",
            )

    # PROJ-49: Playbook-Permission-Check beim Anlegen (AC-SJ-1)
    if body.job_type == "playbook" and current_user.user_id is not None:
        playbook_name = (body.config or {}).get("playbook", "")
        if playbook_name:
            try:
                from backend.services.permissions_resolver import can_user_execute_playbook
                if not await can_user_execute_playbook(current_user.user_id, playbook_name):
                    raise HTTPException(
                        status_code=status.HTTP_412_PRECONDITION_FAILED,
                        detail="playbook_not_authorized",
                    )
            except HTTPException:
                raise
            except Exception:
                pass

    parent = await svc.create_job(
        name=body.name,
        job_type=body.job_type,
        cron_expression=body.cron_expression,
        config=body.config,
        created_by=current_user.username,
        description=body.description,
        active=body.active,
    )

    # PROJ-64: Approval-Check für Scheduled Jobs via Plus-Hook
    if current_user.user_id is not None and body.job_type in ("playbook", "packer"):
        try:
            from backend.db.database import get_db
            from sqlalchemy import text as _text
            from datetime import datetime as _dt, timezone as _tz

            cfg = body.config or {}
            action_target = cfg.get("playbook") or cfg.get("template_id") or ""
            if action_target:
                action_type = "playbook_run" if body.job_type == "playbook" else "packer_build"
                approval_payload = {
                    "target_action_type": action_type,
                    "target_action_target": action_target,
                    "sj_id": parent["id"],
                }
                decision = await plus_behavior.requires_approval(
                    action_type=action_type,
                    payload=approval_payload,
                    user_id=current_user.user_id,
                    username=current_user.username,
                )
                if decision is not None:
                    # Job auf pending_approval in Plus-Tabelle setzen
                    now = _dt.now(_tz.utc).isoformat()
                    async with get_db() as db:
                        await db.execute(
                            _text("""
                                INSERT OR IGNORE INTO scheduled_job_approval_status
                                    (scheduled_job_id, status, reason, updated_at)
                                VALUES (:id, 'pending_approval', 'created_pending', :now)
                            """),
                            {"id": parent["id"], "now": now},
                        )
                        await db.commit()
                    from fastapi.responses import JSONResponse as _JSONResponse
                    return _JSONResponse(
                        status_code=202,
                        content={
                            "status": "pending_approval",
                            "approval_id": decision.approval_id,
                            "poll_url": decision.poll_url,
                            "sj_id": parent["id"],
                        },
                    )
        except Exception:
            pass

    # Zeitfenster-Modus: Child-Job für Stop-Aktion anlegen
    if body.job_type == "power_action" and body.window_mode and body.window_stop_cron:
        stop_config: dict[str, Any] = dict(body.window_stop_config or body.config)
        stop_config["action"] = "stop"
        await svc.create_job(
            name=f"{body.name} (Stop)",
            job_type="power_action",
            cron_expression=body.window_stop_cron,
            config=stop_config,
            created_by=current_user.username,
            description=body.description,
            active=body.active,
            parent_job_id=parent["id"],
        )
        parent = await svc.get_job(parent["id"])  # type: ignore[assignment]

    return _to_response(parent)  # type: ignore[arg-type]


# ── Detail ────────────────────────────────────────────────────────────────────

@router.get("/{job_id}", response_model=ScheduledJobResponse)
async def get_job(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> ScheduledJobResponse:
    job = await svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    _check_ownership(job, current_user)
    return _to_response(job)


# ── Aktualisieren ─────────────────────────────────────────────────────────────

@router.put("/{job_id}", response_model=ScheduledJobResponse)
async def update_job(
    job_id: str,
    body: ScheduledJobUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> ScheduledJobResponse:
    job = await svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    _check_ownership(job, current_user)

    updated = await svc.update_job(
        job_id,
        name=body.name,
        description=body.description,
        cron_expression=body.cron_expression,
        active=body.active,
        config=body.config,
    )

    # Zeitfenster-Modus: Child-Job aktualisieren
    if body.window_stop_cron and updated and updated.get("child_job"):
        child_id = updated["child_job"]["id"]
        child_config = dict(body.window_stop_config or updated["child_job"]["config"])
        child_config["action"] = "stop"
        await svc.update_job(
            child_id,
            cron_expression=body.window_stop_cron,
            active=body.active,
            config=child_config,
        )
        updated = await svc.get_job(job_id)

    return _to_response(updated)  # type: ignore[arg-type]


# ── Löschen ───────────────────────────────────────────────────────────────────

@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    job = await svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    _check_ownership(job, current_user)

    deleted = await svc.delete_job(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Toggle aktiv/inaktiv ──────────────────────────────────────────────────────

@router.post("/{job_id}/toggle", response_model=ScheduledJobResponse)
async def toggle_job(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> ScheduledJobResponse:
    job = await svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    _check_ownership(job, current_user)

    updated = await svc.toggle_job(job_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    return _to_response(updated)


# ── Manueller Run ─────────────────────────────────────────────────────────────

@router.post("/{job_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_now(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Startet einen sofortigen manuellen Run (unabhängig vom Zeitplan)."""
    job = await svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    _check_ownership(job, current_user)

    # Überlappungsschutz: nicht starten wenn gerade läuft
    if job.get("last_run_status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Job läuft bereits. Bitte warten bis er abgeschlossen ist.",
        )

    try:
        # Celery-Pfad: Task per Namen dispatchen (kein Import der Funktion nötig).
        # Task wird im celery-worker via backend.plus.scheduled_jobs.celery.register_tasks
        # unter diesem Namen registriert.
        from backend.celery_app import celery_app
        celery_app.send_task(
            "backend.plus.scheduled_jobs.celery.execute_scheduled_job",
            args=[job_id, "manual"],
        )
        return {"status": "queued", "job_id": job_id}
    except Exception:
        # Celery/Valkey nicht erreichbar → in-Prozess Fallback im portal-Container.
        import asyncio
        from backend.plus.scheduled_jobs.runner import _run_job_async
        asyncio.create_task(_run_job_async(job_id, "manual"))
        return {"status": "queued", "job_id": job_id}


# ── Run-History ───────────────────────────────────────────────────────────────

@router.get("/{job_id}/runs", response_model=list[ScheduledJobRunResponse])
async def get_runs(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ScheduledJobRunResponse]:
    job = await svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    _check_ownership(job, current_user)

    runs = await svc.get_runs(job_id)
    return [
        ScheduledJobRunResponse(
            id=r["id"],
            job_id=r["job_id"],
            started_at=r["started_at"],
            finished_at=r.get("finished_at"),
            status=r["status"],
            exit_code=r.get("exit_code"),
            output=r.get("output"),
            triggered_by=r["triggered_by"],
            action=r.get("action"),
        )
        for r in runs
    ]


# ── Admin-Settings ────────────────────────────────────────────────────────────

@settings_router.get("/settings", response_model=ScheduledJobsSettingsResponse)
async def get_settings(
    _: CurrentUser = Depends(require_admin),
) -> ScheduledJobsSettingsResponse:
    s = await svc.get_settings()
    return ScheduledJobsSettingsResponse(**s)


@settings_router.put("/settings/history-limit", status_code=status.HTTP_204_NO_CONTENT)
async def set_history_limit(
    body: HistoryLimitRequest,
    current_user: CurrentUser = Depends(require_admin),
) -> Response:
    await svc.set_history_limit(body.limit, current_user.username)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@settings_router.put("/settings/system-ssh-key", status_code=status.HTTP_204_NO_CONTENT)
async def set_system_ssh_key(
    body: SystemSshKeyRequest,
    current_user: CurrentUser = Depends(require_admin),
) -> Response:
    await svc.set_system_ssh_key(body.key, current_user.username)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@settings_router.delete("/settings/system-ssh-key", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system_ssh_key(
    _: CurrentUser = Depends(require_admin),
) -> Response:
    await svc.delete_system_ssh_key()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
