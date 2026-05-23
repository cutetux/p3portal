# p3portal.org
"""PROJ-48: FastAPI-Router für das Owners-Modul.

Prefix /api/owners – Owner-Verwaltung.
Cross-cutting: /api/me/owners – eigene Ressourcen für jeden auth. User.
POST /api/owners/bulk – Dashboard-Bulk-Lookup.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.features.api_surface.deps import require_scope_for_upk
from .schemas import (
    AddCoOwnerRequest,
    BulkOwnerRequest,
    MyResourceEntry,
    OwnerEntry,
    OwnerListResponse,
    TransferOwnerRequest,
)
from . import service
from .service import (
    DuplicateOwnerError,
    LastOwnerError,
    LimitExceededError,
)

router = APIRouter(prefix="/api/owners", tags=["owners"])
me_router = APIRouter(prefix="/api/me", tags=["owners"])


# ── GET /api/owners/config ─────────────────────────────────────────────────────

@router.get("/config")
async def get_owner_config(_: CurrentUser = Depends(get_current_user)) -> dict:
    """Gibt die Owner-Feature-Konfiguration zurück.

    Wird vom Frontend genutzt um zu entscheiden, ob die Owner-Checkbox im
    Deploy-Formular angezeigt werden soll (AC-DEPLOY-1).
    """
    import json as _json
    from backend.services.config_service import get_config

    enabled_raw = await get_config("owner_auto_assign_enabled")
    enabled = (enabled_raw is None) or (enabled_raw.lower() != "false")

    cats_raw = await get_config("owner_auto_assign_categories")
    if cats_raw:
        try:
            categories = _json.loads(cats_raw)
        except (ValueError, TypeError):
            categories = ["vm_deployment", "lxc_deployment"]
    else:
        categories = ["vm_deployment", "lxc_deployment"]

    return {
        "owner_auto_assign_enabled": enabled,
        "owner_auto_assign_categories": categories,
    }


# ── GET /api/me/owners ────────────────────────────────────────────────────────

@me_router.get("/owners", response_model=list[MyResourceEntry])
async def my_owners(
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("owners:read")),
):
    """Gibt alle aktiven Owner-Einträge des eingeloggten Users zurück."""
    user_id = await _get_user_id(current_user.username)
    if user_id is None:
        return []
    return await service.list_owners_for_user(user_id)


# ── POST /api/owners/bulk ─────────────────────────────────────────────────────

@router.post("/bulk", response_model=list[dict])
async def bulk_owners(
    body: BulkOwnerRequest,
    _: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("owners:read")),
):
    """Bulk-Lookup: Owner für eine Liste von Ressourcen in einem API-Call."""
    resources = [r.model_dump() for r in body.resources]
    return await service.bulk_list_owners(resources)


# ── GET /api/owners/{rt}/{nid}/{vmid} ─────────────────────────────────────────

@router.get(
    "/{resource_type}/{node_id}/{vmid}",
    response_model=OwnerListResponse,
)
async def list_owners(
    resource_type: str,
    node_id: int,
    vmid: int,
    _: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("owners:read")),
):
    _validate_resource_type(resource_type)
    owners = await service.list_owners_for_resource(resource_type, node_id, vmid)
    return {"owners": owners}


# ── POST /api/owners/{rt}/{nid}/{vmid} – Co-Owner hinzufügen ─────────────────

@router.post(
    "/{resource_type}/{node_id}/{vmid}",
    response_model=OwnerEntry,
    status_code=status.HTTP_201_CREATED,
)
async def add_co_owner(
    resource_type: str,
    node_id: int,
    vmid: int,
    body: AddCoOwnerRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    _validate_resource_type(resource_type)
    actor_user_id = await _get_user_id(current_user.username)
    if actor_user_id is None:
        raise HTTPException(status_code=403, detail="User nicht gefunden")

    # Admin oder bestehender Owner darf Co-Owner hinzufügen
    if current_user.role != "admin":
        if not await service.is_owner(actor_user_id, resource_type, node_id, vmid):
            raise HTTPException(status_code=403, detail="Nur Admin oder Owner darf Co-Owner hinzufügen")

    try:
        return await service.add_owner(
            resource_type=resource_type,
            node_id=node_id,
            vmid=vmid,
            user_id=body.user_id,
            actor_user_id=actor_user_id,
            source="coowner_add",
            actor_username=current_user.username,
        )
    except LimitExceededError as exc:
        raise HTTPException(status_code=status.HTTP_412_PRECONDITION_FAILED, detail=str(exc))
    except DuplicateOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ── DELETE /api/owners/{rt}/{nid}/{vmid}/{user_id} ────────────────────────────

@router.delete(
    "/{resource_type}/{node_id}/{vmid}/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_owner(
    resource_type: str,
    node_id: int,
    vmid: int,
    user_id: int,
    orphan: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    _validate_resource_type(resource_type)
    actor_user_id = await _get_user_id(current_user.username)
    if actor_user_id is None:
        raise HTTPException(status_code=403, detail="User nicht gefunden")

    # Admin oder Owner (für sich selbst) darf entfernen
    if current_user.role != "admin":
        if not await service.is_owner(actor_user_id, resource_type, node_id, vmid):
            raise HTTPException(status_code=403, detail="Nur Admin oder Owner darf Owner entfernen")

    deleted_reason = "self_removed" if actor_user_id == user_id else "admin_removed"

    try:
        await service.remove_owner(
            resource_type=resource_type,
            node_id=node_id,
            vmid=vmid,
            user_id=user_id,
            actor_user_id=actor_user_id,
            actor_username=current_user.username,
            orphan=orphan,
            deleted_reason=deleted_reason,
        )
    except LastOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# ── POST /api/owners/{rt}/{nid}/{vmid}/transfer ───────────────────────────────

@router.post(
    "/{resource_type}/{node_id}/{vmid}/transfer",
    response_model=OwnerEntry,
)
async def transfer_owner(
    resource_type: str,
    node_id: int,
    vmid: int,
    body: TransferOwnerRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    _validate_resource_type(resource_type)
    actor_user_id = await _get_user_id(current_user.username)
    if actor_user_id is None:
        raise HTTPException(status_code=403, detail="User nicht gefunden")

    # Admin oder Owner darf übertragen
    if current_user.role != "admin":
        if not await service.is_owner(actor_user_id, resource_type, node_id, vmid):
            raise HTTPException(status_code=403, detail="Nur Admin oder Owner darf Eigentum übertragen")

    from_user_id = actor_user_id if current_user.role != "admin" else actor_user_id

    try:
        return await service.transfer_owner(
            resource_type=resource_type,
            node_id=node_id,
            vmid=vmid,
            from_user_id=actor_user_id,
            to_user_id=body.to_user_id,
            actor_user_id=actor_user_id,
            actor_username=current_user.username,
        )
    except LimitExceededError as exc:
        raise HTTPException(status_code=status.HTTP_412_PRECONDITION_FAILED, detail=str(exc))
    except DuplicateOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ── POST /api/owners/{rt}/{nid}/{vmid}/adopt ──────────────────────────────────

@router.post(
    "/{resource_type}/{node_id}/{vmid}/adopt",
    response_model=OwnerEntry,
    status_code=status.HTTP_201_CREATED,
)
async def adopt_resource(
    resource_type: str,
    node_id: int,
    vmid: int,
    current_user: CurrentUser = Depends(require_admin),
):
    """Admin-only bis PROJ-50: Adoptiert eine extern angelegte Ressource."""
    _validate_resource_type(resource_type)
    actor_user_id = await _get_user_id(current_user.username)
    if actor_user_id is None:
        raise HTTPException(status_code=403, detail="User nicht gefunden")

    try:
        return await service.adopt(
            resource_type=resource_type,
            node_id=node_id,
            vmid=vmid,
            actor_user_id=actor_user_id,
            actor_username=current_user.username,
        )
    except DuplicateOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except LimitExceededError as exc:
        raise HTTPException(status_code=status.HTTP_412_PRECONDITION_FAILED, detail=str(exc))


# ── POST /api/owners/{rt}/{nid}/{vmid}/delete-request ────────────────────────
# PROJ-64: owner_delete_requests-Stub-Drop – Tabelle wurde mit PROJ-64 entfernt.
# Neue Implementierung erfolgt via pending_approvals (action_type='owner_delete_request')
# in einem späteren Feature-Release.


# ── helpers ───────────────────────────────────────────────────────────────────

def _validate_resource_type(rt: str) -> None:
    if rt not in ("vm", "lxc"):
        raise HTTPException(status_code=400, detail="resource_type muss 'vm' oder 'lxc' sein")


async def _get_user_id(username: str) -> int | None:
    from sqlalchemy import text
    from backend.db.database import get_db
    async with get_db() as db:
        result = await db.execute(
            text("SELECT id FROM local_users WHERE username = :u"),
            {"u": username},
        )
        row = result.fetchone()
        return row[0] if row else None
