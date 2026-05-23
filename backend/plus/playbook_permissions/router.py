# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-49: API-Router für Playbook-Permissions.

Prefixes:
  /api/playbooks/{name}/permissions  – Whitelist-CRUD (Cross-Cutting, PROJ-52 erlaubt)
  /api/playbook-permissions/config   – Default-Mode-Config
  /api/me/playbook-permissions       – Self-Service (eigene erlaubte Playbooks)
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.plus.playbook_permissions import service as svc
from backend.plus.playbook_permissions.schemas import (
    AddPermissionRequest,
    AllowedPlaybook,
    PlaybookPermissionConfig,
    PlaybookPermissionEntry,
    UpdateConfigRequest,
)
from backend.services.playbook_service import get_playbook

logger = logging.getLogger(__name__)

router = APIRouter(tags=["playbook-permissions"])

_require_manage = require_admin_or("manage_playbook_permissions")


def _check_playbook_exists(playbook_name: str) -> None:
    """Wirf HTTP 404 wenn kein Playbook mit diesem Namen bekannt ist."""
    pb = get_playbook(playbook_name)
    if pb is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Playbook '{playbook_name}' nicht gefunden",
        )


# ── Whitelist-CRUD ────────────────────────────────────────────────────────────

@router.get(
    "/api/playbooks/{playbook_name}/permissions",
    response_model=list[PlaybookPermissionEntry],
)
async def list_playbook_permissions(
    playbook_name: str,
    _: CurrentUser = Depends(_require_manage),
) -> list[PlaybookPermissionEntry]:
    _check_playbook_exists(playbook_name)
    entries = await svc.list_permissions(playbook_name)
    return [PlaybookPermissionEntry(**e) for e in entries]


@router.post(
    "/api/playbooks/{playbook_name}/permissions",
    response_model=PlaybookPermissionEntry,
    status_code=status.HTTP_201_CREATED,
)
async def add_playbook_permission(
    playbook_name: str,
    body: AddPermissionRequest,
    current_user: CurrentUser = Depends(_require_manage),
) -> PlaybookPermissionEntry:
    _check_playbook_exists(playbook_name)
    try:
        entry = await svc.add_permission(
            playbook_name=playbook_name,
            subject_type=body.subject_type,
            subject_id=body.subject_id,
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "playbook_permission_duplicate":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Dieser Eintrag existiert bereits (Duplikat).",
            )
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return PlaybookPermissionEntry(**entry)


@router.delete(
    "/api/playbooks/{playbook_name}/permissions/{permission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_playbook_permission(
    playbook_name: str,
    permission_id: int,
    current_user: CurrentUser = Depends(_require_manage),
) -> Response:
    _check_playbook_exists(playbook_name)
    removed = await svc.remove_permission(
        permission_id=permission_id,
        actor_username=current_user.username,
    )
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Config ────────────────────────────────────────────────────────────────────

@router.get(
    "/api/playbook-permissions/config",
    response_model=PlaybookPermissionConfig,
)
async def get_config(
    _: CurrentUser = Depends(_require_manage),
) -> PlaybookPermissionConfig:
    mode = await svc.get_default_playbook_mode()
    return PlaybookPermissionConfig(default_playbook_mode=mode)


@router.put(
    "/api/playbook-permissions/config",
    response_model=PlaybookPermissionConfig,
)
async def update_config(
    body: UpdateConfigRequest,
    current_user: CurrentUser = Depends(_require_manage),
) -> PlaybookPermissionConfig:
    try:
        mode = await svc.set_default_playbook_mode(
            body.default_playbook_mode, current_user.username, current_user.user_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return PlaybookPermissionConfig(default_playbook_mode=mode)


# ── Self-Service ──────────────────────────────────────────────────────────────

@router.get(
    "/api/me/playbook-permissions",
    response_model=list[AllowedPlaybook],
)
async def get_my_playbook_permissions(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[AllowedPlaybook]:
    if current_user.user_id is None:
        return []
    entries = await svc.get_allowed_playbooks_for_user(current_user.user_id)
    return [AllowedPlaybook(**e) for e in entries]
