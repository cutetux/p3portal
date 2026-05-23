# p3portal.org
"""PROJ-65: Notification Hub – API-Router.

Endpoints:
  GET  /api/notifications/unread-summary
  GET  /api/notifications?tab=alerts|announcements|events&limit=200
  POST /api/notifications/read
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.routers.auth import get_current_user
from backend.features.notifications import service
from backend.features.notifications.schemas import (
    MarkReadRequest,
    MarkReadResponse,
    NotificationItem,
    NotificationSummary,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

_VALID_TABS = {"alerts", "announcements", "events"}


@router.get("/unread-summary", response_model=NotificationSummary)
async def get_unread_summary(
    user=Depends(get_current_user),
):
    """Anzahl ungelesener Notifications pro Quelle + max. Severity."""
    return await service.get_unread_summary(user)


@router.get("", response_model=list[NotificationItem])
async def get_notifications(
    tab: Annotated[str, Query(description="alerts | announcements | events")] = "announcements",
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    user=Depends(get_current_user),
):
    """Notification-Items für einen Tab abrufen."""
    if tab not in _VALID_TABS:
        raise HTTPException(status_code=422, detail=f"tab muss eines von {sorted(_VALID_TABS)} sein")
    return await service.fetch_tab(user, tab=tab, limit=limit)


@router.post("/read", response_model=MarkReadResponse)
async def mark_read(
    body: MarkReadRequest,
    user=Depends(get_current_user),
):
    """Notifications als gelesen markieren (max. 200 IDs pro Request)."""
    return await service.bulk_mark_read(user, source=body.source, source_ids=body.source_ids)
