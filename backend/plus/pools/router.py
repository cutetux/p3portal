# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-46: FastAPI-Router für das Pools-Modul.

Prefix /api/pools – Verwaltung erfordert manage_pools oder admin.
Lesende Endpunkte für normale User sind rollenabhängig gefiltert (AC-31).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.features.api_surface.deps import require_scope_for_upk
from .schemas import (
    MyPoolEntry,
    PoolAssignmentAddRequest,
    PoolAssignmentResponse,
    PoolCreateRequest,
    PoolDeletePreview,
    PoolDetailResponse,
    PoolMemberAddRequest,
    PoolMemberBulkAddRequest,
    PoolMemberResponse,
    PoolResponse,
    PoolUpdateRequest,
    PoolUsageResponse,
    TagsPoolResponse,
    VmPoolMoveRequest,
)
from . import service

router = APIRouter(prefix="/api/pools", tags=["pools"])

_require_manage = require_admin_or("manage_pools")


def _is_manager(user: CurrentUser) -> bool:
    return user.role == "admin" or "manage_pools" in user.portal_permissions


# ── GET /api/pools ────────────────────────────────────────────────────────────

@router.get("", response_model=list[PoolResponse])
async def list_pools(
    search: str | None = Query(None),
    no_owner: bool = Query(False),
    tag: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("pools:read")),
):
    return await service.list_pools(
        is_manager=_is_manager(current_user),
        username=current_user.username,
        search=search,
        no_owner=no_owner,
        tag=tag,
    )


# ── POST /api/pools ───────────────────────────────────────────────────────────

@router.post("", response_model=PoolDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_pool(
    body: PoolCreateRequest,
    current_user: CurrentUser = Depends(_require_manage),
    _scope: CurrentUser = Depends(require_scope_for_upk("pools:write")),
):
    try:
        pool = await service.create_pool(
            name=body.name,
            description=body.description,
            tags=body.tags,
            owner_subject_type=body.owner_subject_type,
            owner_subject_id=body.owner_subject_id,
            cpu_quota=body.cpu_quota,
            ram_quota_mb=body.ram_quota_mb,
            disk_quota_gb=body.disk_quota_gb,
            vm_count_quota=body.vm_count_quota,
            created_by=current_user.username,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        msg = str(exc)
        if "existiert bereits" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return pool


# ── GET /api/pools/tags ───────────────────────────────────────────────────────

@router.get("/tags", response_model=TagsPoolResponse)
async def get_tags_pool(_: CurrentUser = Depends(_require_manage)):
    tags = await service.get_tags_pool()
    return {"tags": tags}


# ── GET /api/pools/{id}/delete-preview ───────────────────────────────────────

@router.get("/{pool_id}/delete-preview", response_model=PoolDeletePreview)
async def delete_preview(
    pool_id: int,
    _: CurrentUser = Depends(_require_manage),
):
    preview = await service.get_pool_delete_preview(pool_id)
    if preview is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pool nicht gefunden")
    return preview


# ── GET /api/pools/{id} ───────────────────────────────────────────────────────

@router.get("/{pool_id}", response_model=PoolDetailResponse)
async def get_pool(
    pool_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    if not _is_manager(current_user):
        # Verify the user actually has access to this pool
        my_pools = await service.get_my_pools(current_user.username)
        if not any(p["id"] == pool_id for p in my_pools):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Kein Zugriff auf diesen Pool",
            )
    pool = await service.get_pool(pool_id)
    if pool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pool nicht gefunden")
    return pool


# ── PUT /api/pools/{id} ───────────────────────────────────────────────────────

@router.put("/{pool_id}", response_model=PoolDetailResponse)
async def update_pool(
    pool_id: int,
    body: PoolUpdateRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        pool = await service.update_pool(
            pool_id=pool_id,
            name=body.name,
            description=body.description,
            tags=body.tags,
            owner_subject_type=body.owner_subject_type,
            owner_subject_id=body.owner_subject_id,
            clear_owner=body.clear_owner,
            cpu_quota=body.cpu_quota,
            ram_quota_mb=body.ram_quota_mb,
            disk_quota_gb=body.disk_quota_gb,
            vm_count_quota=body.vm_count_quota,
            updated_by=current_user.username,
        )
    except ValueError as exc:
        msg = str(exc)
        if "existiert bereits" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    if pool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pool nicht gefunden")
    return pool


# ── DELETE /api/pools/{id} ────────────────────────────────────────────────────

@router.delete("/{pool_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pool(
    pool_id: int,
    current_user: CurrentUser = Depends(_require_manage),
):
    deleted = await service.delete_pool(pool_id, current_user.username)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pool nicht gefunden")
    try:
        from backend.features.sidebar_pins.service import cleanup_pins_for_resource
        await cleanup_pins_for_resource("pool", str(pool_id), current_user.username)
    except Exception:
        pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── POST /api/pools/{id}/members ──────────────────────────────────────────────

@router.post(
    "/{pool_id}/members",
    response_model=PoolMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    pool_id: int,
    body: PoolMemberAddRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        member = await service.add_pool_member(
            pool_id=pool_id,
            resource_type=body.resource_type,
            node_id=body.node_id,
            vmid=body.vmid,
            added_by=current_user.username,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        msg = str(exc)
        if "bereits Pool" in msg or "bereits einem Pool" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return member


# ── POST /api/pools/{id}/members:bulk ────────────────────────────────────────

@router.post(
    "/{pool_id}/members:bulk",
    response_model=list[PoolMemberResponse],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_add_members(
    pool_id: int,
    body: PoolMemberBulkAddRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        members = await service.bulk_add_pool_members(
            pool_id=pool_id,
            members=[m.model_dump() for m in body.members],
            added_by=current_user.username,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        msg = str(exc)
        if "bereits einem Pool" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return members


# ── DELETE /api/pools/{id}/members/{node_id}/{vmid} ──────────────────────────

@router.delete(
    "/{pool_id}/members/{node_id}/{vmid}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    pool_id: int,
    node_id: int,
    vmid: int,
    current_user: CurrentUser = Depends(_require_manage),
):
    removed = await service.remove_pool_member(pool_id, node_id, vmid, current_user.username)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitglied nicht in diesem Pool gefunden",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── POST /api/pools/{id}/assignments ─────────────────────────────────────────

@router.post(
    "/{pool_id}/assignments",
    response_model=PoolAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_assignment(
    pool_id: int,
    body: PoolAssignmentAddRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        asgn = await service.add_pool_assignment(
            pool_id=pool_id,
            subject_type=body.subject_type,
            subject_id=body.subject_id,
            role_preset_id=body.role_preset_id,
            added_by=current_user.username,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return asgn


# ── DELETE /api/pools/{id}/assignments/{subject_type}/{subject_id} ────────────

@router.delete(
    "/{pool_id}/assignments/{subject_type}/{subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_assignment(
    pool_id: int,
    subject_type: str,
    subject_id: int,
    current_user: CurrentUser = Depends(_require_manage),
):
    if subject_type not in ("user", "group"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="subject_type muss 'user' oder 'group' sein",
        )
    removed = await service.remove_pool_assignment(
        pool_id, subject_type, subject_id, current_user.username
    )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Zuweisung nicht gefunden"
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── GET /api/pools/{id}/usage ─────────────────────────────────────────────────

@router.get("/{pool_id}/usage", response_model=PoolUsageResponse)
async def get_usage(
    pool_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    if not _is_manager(current_user):
        my_pools = await service.get_my_pools(current_user.username)
        if not any(p["id"] == pool_id for p in my_pools):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Kein Zugriff auf diesen Pool",
            )
    usage = await service.get_pool_usage(pool_id)
    if usage is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pool nicht gefunden")
    return usage


# ── GET /api/me/pools ─────────────────────────────────────────────────────────
# Note: this sub-router is mounted under /api/pools but the actual path needs
# to be accessible at /api/me/pools. We handle it in main.py via a separate router.

me_router = APIRouter(prefix="/api/me", tags=["pools"])


@me_router.get("/pools", response_model=list[MyPoolEntry])
async def get_my_pools(current_user: CurrentUser = Depends(get_current_user)):
    return await service.get_my_pools(current_user.username)


# ── PUT /api/vms/{node_id}/{vmid}/pool ───────────────────────────────────────

vms_router = APIRouter(prefix="/api/vms", tags=["pools"])


@vms_router.put("/{node_id}/{vmid}/pool")
async def move_vm_pool(
    node_id: int,
    vmid: int,
    body: VmPoolMoveRequest,
    current_user: CurrentUser = Depends(_require_manage),
):
    try:
        result = await service.move_vm_pool(
            node_id=node_id,
            vmid=vmid,
            new_pool_id=body.pool_id,
            moved_by=current_user.username,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return result or {"node_id": node_id, "vmid": vmid, "pool_id": None}
