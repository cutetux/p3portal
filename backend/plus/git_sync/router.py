# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: FastAPI-Router für Git-Sync (geschützt – JWT + Admin required).

Prefix /api/git-sync.
Plus-Gate: 412 für Core-Nutzer (kein can_use_git_sync).
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.core.plus_protocol import plus_behavior
from .schemas import (
    ConflictResolveRequest,
    GitSyncConfigResponse,
    GitSyncConfigUpdate,
    GitSyncConflict,
    GitSyncLogEntry,
    SshPublicKeyResponse,
    SyncTriggerResponse,
    WebhookTokenResponse,
)
from . import service

router = APIRouter(prefix="/api/git-sync", tags=["git-sync"])

_require_admin = require_admin_or("manage_settings")


def _check_plus() -> None:
    if not plus_behavior.can_use_git_sync():
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail="Git-Sync ist ein Plus-Feature",
        )


def _validate_repo_type(repo_type: str) -> str:
    if repo_type not in ("ansible", "packer"):
        raise HTTPException(status_code=400, detail="repo_type muss 'ansible' oder 'packer' sein")
    return repo_type


# ── GET /api/git-sync/config/{repo_type} ─────────────────────────────────────

@router.get("/config/{repo_type}", response_model=GitSyncConfigResponse)
async def get_config(
    repo_type: str,
    _user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    return await service.get_config_for_api(repo_type)


# ── PUT /api/git-sync/config/{repo_type} ─────────────────────────────────────

@router.put("/config/{repo_type}", response_model=GitSyncConfigResponse)
async def update_config(
    repo_type: str,
    body: GitSyncConfigUpdate,
    current_user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    from backend.services.audit_service import write_audit_log
    result = await service.upsert_config(repo_type, body.model_dump(), current_user.username)
    await write_audit_log(
        "git_sync_configured",
        username=current_user.username,
        detail=f'{{"repo_type": "{repo_type}", "enabled": {str(body.enabled).lower()}}}',
    )
    return result


# ── DELETE /api/git-sync/config/{repo_type} ──────────────────────────────────

@router.delete("/config/{repo_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    repo_type: str,
    current_user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    await service.delete_config(repo_type)
    from backend.services.audit_service import write_audit_log
    await write_audit_log(
        "git_sync_configured",
        username=current_user.username,
        detail=f'{{"repo_type": "{repo_type}", "action": "deleted"}}',
    )


# ── GET /api/git-sync/config/{repo_type}/ssh-key ─────────────────────────────

@router.get("/config/{repo_type}/ssh-key", response_model=SshPublicKeyResponse)
async def get_ssh_key(
    repo_type: str,
    _user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    pub_key = await service.get_ssh_public_key(repo_type)
    if not pub_key:
        raise HTTPException(status_code=404, detail="Kein SSH-Key vorhanden – erst generieren")
    return SshPublicKeyResponse(public_key=pub_key, repo_type=repo_type)


# ── POST /api/git-sync/config/{repo_type}/regenerate-ssh-key ─────────────────

@router.post("/config/{repo_type}/regenerate-ssh-key", response_model=SshPublicKeyResponse)
async def regenerate_ssh_key(
    repo_type: str,
    current_user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    pub_key = await service.regenerate_ssh_key(repo_type, current_user.username)
    return SshPublicKeyResponse(public_key=pub_key, repo_type=repo_type)


# ── POST /api/git-sync/config/{repo_type}/regenerate-webhook-token ───────────

@router.post("/config/{repo_type}/regenerate-webhook-token", response_model=WebhookTokenResponse)
async def regenerate_webhook_token(
    repo_type: str,
    current_user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    new_token = await service.regenerate_webhook_token(repo_type, current_user.username)
    return WebhookTokenResponse(
        webhook_url_template=f"/api/git-sync/webhook/{repo_type}/{new_token}",
        repo_type=repo_type,
    )


# ── POST /api/git-sync/sync/{repo_type} ──────────────────────────────────────

@router.post("/sync/{repo_type}", response_model=SyncTriggerResponse)
async def trigger_sync(
    repo_type: str,
    current_user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    sync_status = await service.trigger_sync(repo_type, triggered_by="manual")
    msg = "Sync gestartet" if sync_status == "started" else "Sync wird nach aktuellem Lauf ausgeführt"
    return SyncTriggerResponse(status=sync_status, message=msg)


# ── GET /api/git-sync/logs/{repo_type} ───────────────────────────────────────

@router.get("/logs/{repo_type}", response_model=list[GitSyncLogEntry])
async def list_logs(
    repo_type: str,
    _user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    _validate_repo_type(repo_type)
    return await service.list_sync_logs(repo_type)


# ── GET /api/git-sync/conflicts ──────────────────────────────────────────────

@router.get("/conflicts", response_model=list[GitSyncConflict])
async def list_conflicts(
    _user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    return await service.list_conflicts(open_only=False)


# ── POST /api/git-sync/conflicts/{id}/resolve ────────────────────────────────

@router.post("/conflicts/{conflict_id}/resolve", status_code=status.HTTP_200_OK)
async def resolve_conflict(
    conflict_id: int,
    body: ConflictResolveRequest,
    current_user: CurrentUser = Depends(_require_admin),
):
    _check_plus()
    ok = await service.resolve_conflict(conflict_id, body.resolution, current_user.username)
    if not ok:
        raise HTTPException(status_code=404, detail="Konflikt nicht gefunden")
    from backend.services.audit_service import write_audit_log
    await write_audit_log(
        "git_sync_conflict_resolved",
        username=current_user.username,
        detail=f'{{"conflict_id": {conflict_id}, "resolution": "{body.resolution}"}}',
    )
    return {"status": "resolved", "resolution": body.resolution}
