# p3portal.org
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.services import announcement_service
from backend.services.announcement_service import MISSING

router = APIRouter(tags=["announcements"])

_manage = require_admin_or("manage_announcements")

VALID_SEVERITIES = ("info", "warn", "critical", "success")


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class AnnouncementResponse(BaseModel):
    id: int
    message: str
    severity: str
    active: bool
    expires_at: Optional[str] = None
    created_by: str
    created_at: str
    updated_at: str
    expired: bool = False


class AnnouncementCreateRequest(BaseModel):
    message: str
    severity: str = "info"
    active: bool = True
    expires_at: Optional[str] = None

    @field_validator("message")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message must not be empty")
        return v

    @field_validator("severity")
    @classmethod
    def valid_severity(cls, v: str) -> str:
        if v not in VALID_SEVERITIES:
            raise ValueError(f"severity must be one of: {', '.join(VALID_SEVERITIES)}")
        return v

    @field_validator("expires_at")
    @classmethod
    def expires_in_future(cls, v: str | None) -> str | None:
        if v is None:
            return v
        now = datetime.now(timezone.utc).isoformat()
        if v <= now:
            raise ValueError("expires_at must be in the future for new announcements")
        return v


class AnnouncementUpdateRequest(BaseModel):
    """All fields optional. expires_at=None clears the field; omitting it keeps the current value."""
    message: Optional[str] = None
    severity: Optional[str] = None
    active: Optional[bool] = None
    expires_at: Optional[str] = None

    @field_validator("message")
    @classmethod
    def not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("message must not be empty")
        return v

    @field_validator("severity")
    @classmethod
    def valid_severity(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_SEVERITIES:
            raise ValueError(f"severity must be one of: {', '.join(VALID_SEVERITIES)}")
        return v


# ── Public (authenticated) ─────────────────────────────────────────────────────

@router.get("/api/announcements", response_model=list[AnnouncementResponse])
async def get_active_announcements(
    _: CurrentUser = Depends(get_current_user),
) -> list[AnnouncementResponse]:
    """Active, non-expired announcements for the Dashboard."""
    items = await announcement_service.list_active()
    return [AnnouncementResponse(**i) for i in items]


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/api/admin/announcements", response_model=list[AnnouncementResponse])
async def admin_list_announcements(
    _: CurrentUser = Depends(_manage),
) -> list[AnnouncementResponse]:
    """All announcements (incl. inactive/expired) for the Admin table."""
    items = await announcement_service.list_all()
    return [AnnouncementResponse(**i) for i in items]


@router.post("/api/admin/announcements", response_model=AnnouncementResponse, status_code=201)
async def admin_create_announcement(
    body: AnnouncementCreateRequest,
    current_user: CurrentUser = Depends(_manage),
) -> AnnouncementResponse:
    item = await announcement_service.create(
        message=body.message,
        severity=body.severity,
        active=body.active,
        expires_at=body.expires_at,
        created_by=current_user.username,
    )
    return AnnouncementResponse(**item)


@router.put("/api/admin/announcements/{announcement_id}", response_model=AnnouncementResponse)
async def admin_update_announcement(
    announcement_id: int,
    body: AnnouncementUpdateRequest,
    _: CurrentUser = Depends(_manage),
) -> AnnouncementResponse:
    # Use model_fields_set to detect whether expires_at was explicitly provided.
    # If not provided → MISSING (keep existing). If provided (even as null) → use value.
    expires_at = body.expires_at if "expires_at" in body.model_fields_set else MISSING

    item = await announcement_service.update(
        announcement_id=announcement_id,
        message=body.message,
        severity=body.severity,
        active=body.active,
        expires_at=expires_at,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Ankündigung nicht gefunden")
    return AnnouncementResponse(**item)


@router.delete("/api/admin/announcements/{announcement_id}", status_code=204)
async def admin_delete_announcement(
    announcement_id: int,
    _: CurrentUser = Depends(_manage),
) -> Response:
    found = await announcement_service.delete(announcement_id)
    if not found:
        raise HTTPException(status_code=404, detail="Ankündigung nicht gefunden")
    return Response(status_code=204)
