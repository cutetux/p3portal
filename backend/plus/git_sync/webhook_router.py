# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Öffentlicher Webhook-Endpoint für Git-Push-Trigger.

Kein JWT erforderlich – Token-Auth über den Pfad-Parameter.
POST /api/git-sync/webhook/{repo_type}/{webhook_token}
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from . import service

logger = logging.getLogger(__name__)

webhook_router = APIRouter(prefix="/api/git-sync", tags=["git-sync-webhook"])


@webhook_router.post(
    "/webhook/{repo_type}/{webhook_token}",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Git-Sync via Webhook auslösen (kein JWT, Token-Auth)",
)
async def webhook_trigger(
    repo_type: str,
    webhook_token: str,
):
    if repo_type not in ("ansible", "packer"):
        raise HTTPException(status_code=400, detail="Ungültiger repo_type")

    valid = await service.verify_webhook_token(repo_type, webhook_token)
    if not valid:
        # 401 statt 403 – kein Leak ob Token existiert
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ungültiger Webhook-Token",
        )

    sync_status = await service.trigger_sync(repo_type, triggered_by="webhook")
    logger.info("Webhook-Sync für %s ausgelöst: %s", repo_type, sync_status)
    return {"status": sync_status, "repo_type": repo_type}
