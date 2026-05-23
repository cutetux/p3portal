# p3portal.org
"""PROJ-45: FastAPI-Router für das Groups-Modul.

Prefix /api/groups – nur für User mit manage_groups oder admin.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.features.api_surface.deps import require_scope_for_upk
from .schemas import (
    GroupCreateRequest,
    GroupDetailResponse,
    GroupResponse,
    GroupUpdateRequest,
    MemberAddRequest,
    MemberResponse,
    MyGroupEntry,
    TagsPoolResponse,
)
from . import service

router = APIRouter(prefix="/api/groups", tags=["groups"])

_require_manage = require_admin_or("manage_groups")


# ── GET /api/groups ───────────────────────────────────────────────────────────

@router.get("", response_model=list[GroupResponse])
async def list_groups(
    search: str | None = Query(None),
    no_owner: bool = Query(False),
    tag: str | None = Query(None),
    _: CurrentUser = Depends(_require_manage),
    _scope: CurrentUser = Depends(require_scope_for_upk("groups:read")),
):
    return await service.list_groups(search=search, no_owner=no_owner, tag=tag)


# ── POST /api/groups ──────────────────────────────────────────────────────────

@router.post("", response_model=GroupDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreateRequest,
    current_user: CurrentUser = Depends(_require_manage),
    _scope: CurrentUser = Depends(require_scope_for_upk("groups:write")),
):
    try:
        group = await service.create_group(
            name=body.name,
            description=body.description,
            tags=body.tags,
            owner_user_id=body.owner_user_id,
            created_by=current_user.username,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        msg = str(exc)
        if "existiert bereits" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return group


# ── GET /api/groups/tags ──────────────────────────────────────────────────────

@router.get("/tags", response_model=TagsPoolResponse)
async def get_tags_pool(_: CurrentUser = Depends(_require_manage)):
    tags = await service.get_tags_pool()
    return {"tags": tags}


# ── GET /api/groups/{id} ──────────────────────────────────────────────────────

@router.get("/{group_id}", response_model=GroupDetailResponse)
async def get_group(
    group_id: int,
    _: CurrentUser = Depends(_require_manage),
):
    group = await service.get_group(group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gruppe nicht gefunden")
    return group


# ── PUT /api/groups/{id} ──────────────────────────────────────────────────────

@router.put("/{group_id}", response_model=GroupDetailResponse)
async def update_group(
    group_id: int,
    body: GroupUpdateRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        group = await service.update_group(
            group_id=group_id,
            name=body.name,
            description=body.description,
            tags=body.tags,
            owner_user_id=body.owner_user_id,
            clear_owner=body.clear_owner,
            updated_by=current_user.username,
        )
    except ValueError as exc:
        msg = str(exc)
        if "existiert bereits" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gruppe nicht gefunden")
    return group


# ── DELETE /api/groups/{id} ───────────────────────────────────────────────────

@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: int,
    current_user: CurrentUser = Depends(_require_manage),
):
    deleted = await service.delete_group(group_id, current_user.username)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gruppe nicht gefunden")
    try:
        from backend.features.sidebar_pins.service import cleanup_pins_for_resource
        await cleanup_pins_for_resource("group", str(group_id), current_user.username)
    except Exception:
        pass
    # PROJ-47: Node-Assignments-Cleanup für gelöschte Gruppe
    try:
        from backend.features.node_assignments.service import cleanup_assignments_for_group
        await cleanup_assignments_for_group(group_id, current_user.username)
    except Exception:
        pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── POST /api/groups/{id}/members ─────────────────────────────────────────────

@router.post("/{group_id}/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    group_id: int,
    body: MemberAddRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        member = await service.add_member(group_id, body.user_id, current_user.username)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        msg = str(exc)
        if "bereits Mitglied" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return member


# ── DELETE /api/groups/{id}/members/{user_id} ─────────────────────────────────

@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    group_id: int,
    user_id: int,
    current_user: CurrentUser = Depends(_require_manage),
):
    removed = await service.remove_member(group_id, user_id, current_user.username)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitglied nicht in dieser Gruppe gefunden",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── POST /api/groups/{id}/join-request ───────────────────────────────────────

@router.post("/{group_id}/join-request", status_code=status.HTTP_202_ACCEPTED)
async def join_request(
    group_id: int,
    body: dict | None = None,
    current_user: CurrentUser = Depends(get_current_user),
):
    # PROJ-64: Group-Join via Self-Service ist Phase-2 (noch nicht implementiert)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Self-Service-Beitritt ist erst nach PROJ-50 Phase-2 verfügbar.",
    )

    if current_user.auth_type != "local":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nur lokale Portal-Nutzer können Beitrittsanfragen stellen.",
        )

    reason = body.get("reason") if body else None
    try:
        user_id = await _get_user_id_for(current_user.username)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nutzer nicht gefunden.",
        )

    try:
        await service.create_join_request(group_id, user_id, current_user.username, reason)
    except NotImplementedError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Self-Service-Beitritt ist erst nach PROJ-50 Phase-2 verfügbar.",
        )
    except ValueError as exc:
        msg = str(exc)
        if "bereits Mitglied" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return {"detail": "Beitrittsanfrage wurde eingereicht."}


async def _get_user_id_for(username: str) -> int:
    from backend.db.database import get_db
    from sqlalchemy import text
    async with get_db() as db:
        result = await db.execute(
            text("SELECT id FROM local_users WHERE username = :u"),
            {"u": username},
        )
        row = result.fetchone()
        if not row:
            raise ValueError(f"Nutzer {username} nicht gefunden")
        return row[0]
