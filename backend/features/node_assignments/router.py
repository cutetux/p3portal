# p3portal.org
"""PROJ-47: FastAPI-Router für das Node-Assignments-Modul.

Prefix /api/nodes/{node_id}/assignments – Verwaltung erfordert admin oder manage_nodes.
GET /api/me/node-assignments – eigene Node-Zugriffe für jeden authentifizierten User.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from .schemas import (
    MyNodeAssignmentEntry,
    NodeAssignmentAddRequest,
    NodeAssignmentResponse,
    NodeAssignmentUpdateRequest,
)
from . import service

router = APIRouter(prefix="/api/nodes", tags=["node_assignments"])
me_router = APIRouter(prefix="/api/me", tags=["node_assignments"])

_require_manage = require_admin_or("manage_nodes")


# ── GET /api/nodes/{node_id}/assignments ──────────────────────────────────────

@router.get("/{node_id}/assignments", response_model=list[NodeAssignmentResponse])
async def list_assignments(
    node_id: int,
    _: CurrentUser = Depends(_require_manage),
):
    try:
        return await service.list_assignments(node_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# ── POST /api/nodes/{node_id}/assignments ────────────────────────────────────

@router.post(
    "/{node_id}/assignments",
    response_model=NodeAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_assignment(
    node_id: int,
    body: NodeAssignmentAddRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        return await service.add_assignment(
            node_id=node_id,
            subject_type=body.subject_type,
            subject_id=body.subject_id,
            role_preset_id=body.role_preset_id,
            added_by=current_user.username,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        msg = str(exc)
        if "bereits eine Zuweisung" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)


# ── PUT /api/nodes/{node_id}/assignments/{subject_type}/{subject_id} ─────────

@router.put(
    "/{node_id}/assignments/{subject_type}/{subject_id}",
    response_model=NodeAssignmentResponse,
)
async def update_assignment(
    node_id: int,
    subject_type: str,
    subject_id: int,
    body: NodeAssignmentUpdateRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    if subject_type not in ("user", "group"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="subject_type muss 'user' oder 'group' sein",
        )
    try:
        result = await service.update_assignment(
            node_id=node_id,
            subject_type=subject_type,
            subject_id=subject_id,
            new_preset_id=body.role_preset_id,
            changed_by=current_user.username,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zuweisung nicht gefunden")
    return result


# ── DELETE /api/nodes/{node_id}/assignments/{subject_type}/{subject_id} ───────

@router.delete(
    "/{node_id}/assignments/{subject_type}/{subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_assignment(
    node_id: int,
    subject_type: str,
    subject_id: int,
    current_user: CurrentUser = Depends(_require_manage),
):
    if subject_type not in ("user", "group"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="subject_type muss 'user' oder 'group' sein",
        )
    removed = await service.remove_assignment(
        node_id=node_id,
        subject_type=subject_type,
        subject_id=subject_id,
        removed_by=current_user.username,
        source="manual",
    )
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zuweisung nicht gefunden")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── GET /api/me/node-assignments ──────────────────────────────────────────────

@me_router.get("/node-assignments", response_model=list[MyNodeAssignmentEntry])
async def get_my_node_assignments(
    current_user: CurrentUser = Depends(get_current_user),
):
    return await service.get_my_node_assignments(current_user.username)
