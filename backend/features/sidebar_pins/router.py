# p3portal.org
"""PROJ-54: FastAPI-Router für Sidebar-Pins.

Prefix /api/sidebar-pins – alle Endpunkte benötigen authentifizierten Nutzer.
Pins sind streng pro-User; Cross-User-Zugriff liefert 404.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import text

from backend.core.deps import CurrentUser, get_current_user
from backend.core.license import is_plus_edition
from backend.db.database import get_db
from .schemas import PinCreateRequest, PinCreateResponse, PinResponse, PinUpdateRequest, ReorderRequest
from . import service

router = APIRouter(prefix="/api/sidebar-pins", tags=["sidebar-pins"])


async def _get_user_id(username: str) -> int:
    """Liest die numerische user_id aus der local_users-Tabelle."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT id FROM local_users WHERE username = :u"),
            {"u": username},
        )
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Nutzer nicht gefunden")
    return row[0]


# ── GET /api/sidebar-pins ────────────────────────────────────────────────────

@router.get("", response_model=list[PinResponse])
async def list_pins(current_user: CurrentUser = Depends(get_current_user)):
    user_id = await _get_user_id(current_user.username)
    return await service.list_pins(
        user_id=user_id,
        username=current_user.username,
        user_permissions=list(current_user.portal_permissions or []),
        is_admin=current_user.role == "admin",
        is_plus=is_plus_edition(),
    )


# ── POST /api/sidebar-pins ───────────────────────────────────────────────────

@router.post("", response_model=PinCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_pin(
    body: PinCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = await _get_user_id(current_user.username)
    try:
        pin, warning = await service.add_pin(
            user_id=user_id,
            username=current_user.username,
            is_plus=is_plus_edition(),
            route=body.route,
            label=body.label,
            pin_kind=body.pin_kind,
            resource_ref=body.resource_ref,
        )
    except PermissionError as exc:
        try:
            detail = json.loads(str(exc))
        except (json.JSONDecodeError, ValueError):
            detail = str(exc)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"pin": pin, "warning": warning}


# ── PATCH /api/sidebar-pins/{id} ─────────────────────────────────────────────

@router.patch("/{pin_id}", response_model=PinResponse)
async def update_pin(
    pin_id: int,
    body: PinUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = await _get_user_id(current_user.username)
    pin = await service.update_pin_label(
        pin_id=pin_id,
        user_id=user_id,
        username=current_user.username,
        label=body.label,
    )
    if pin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pin nicht gefunden")
    return pin


# ── DELETE /api/sidebar-pins/{id} ────────────────────────────────────────────

@router.delete("/{pin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pin(
    pin_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = await _get_user_id(current_user.username)
    deleted = await service.delete_pin(
        pin_id=pin_id,
        user_id=user_id,
        username=current_user.username,
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pin nicht gefunden")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── PUT /api/sidebar-pins/reorder ────────────────────────────────────────────

@router.put("/reorder", response_model=list[PinResponse])
async def reorder_pins(
    body: ReorderRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = await _get_user_id(current_user.username)
    try:
        pins = await service.reorder_pins(
            user_id=user_id,
            username=current_user.username,
            pin_ids=body.pin_ids,
        )
    except ValueError as exc:
        try:
            detail = json.loads(str(exc))
        except (json.JSONDecodeError, ValueError):
            detail = str(exc)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    return pins
