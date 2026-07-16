# p3portal.org
"""PROJ-42 Phase 1 – Core Simple-IPAM Router (`/api/ipam`).

- Pool-CRUD: Admin ODER `manage_ipam` (`require_admin_or`). In Core hat niemand
  `manage_ipam` (erst Plus vergibt es) → effektiv Admin-only, wie im Design
  vorgesehen; in Plus wird derselbe Check zu „Admin oder manage_ipam".
- Deploy-Auflösung (`/pools/by-network`, `/suggest`): jeder nicht-restricted
  Nutzer (wird beim Deploy gebraucht).

PROJ-97: upk_-Scopes ipam:read (GET) / ipam:write (Mutationen).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.core.deps import (
    CurrentUser,
    get_current_user,
    require_admin_or,
    require_not_restricted,
)
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97
from backend.features.ipam import service
from backend.features.ipam.schemas import (
    IpPoolCreateRequest,
    IpPoolResponse,
    IpPoolUpdateRequest,
    SuggestResponse,
)
from backend.routers.cluster import collect_used_ipv4s

router = APIRouter(prefix="/api/ipam", tags=["ipam"])

_SCOPE_READ = Depends(require_scope_for_upk("ipam:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("ipam:write"))

# Admin ODER manage_ipam – in Core faktisch Admin-only (manage_ipam erst in Plus).
_manage = require_admin_or("manage_ipam")


# ── Pool-Verwaltung ───────────────────────────────────────────────────────────

@router.get("/pools", response_model=list[IpPoolResponse])
async def list_pools(_: CurrentUser = Depends(_manage), __=_SCOPE_READ):
    return await service.list_pools()


@router.post("/pools", response_model=IpPoolResponse, status_code=status.HTTP_201_CREATED)
async def create_pool(
    body: IpPoolCreateRequest,
    current_user: CurrentUser = Depends(_manage),
    __=_SCOPE_WRITE,
):
    try:
        return await service.create_pool(body, created_by=current_user.username)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


# literaler Pfad VOR /pools/{pool_id}, sonst matcht "available" als pool_id.
# Deploy-Nutzer (nicht-restricted) brauchen die Pool-Liste, um im IP-Feld direkt
# einen Pool zu wählen — unabhängig davon, ob das Playbook ein Bridge-Feld hat.
# Phase 1: alle Pools; Phase 2 (Plus) filtert nach Netz-Freigaben.
@router.get("/pools/available", response_model=list[IpPoolResponse])
async def pools_available(
    current_user: CurrentUser = Depends(require_not_restricted),
    __=_SCOPE_READ,
):
    pools = await service.list_pools()
    # PROJ-42 Phase 2: Pool-Sicht erbt die Netz-Freigaben (Plus, strict).
    # Core-Default = alle Pools durchreichen.
    from backend.core.plus_protocol import plus_behavior
    return await plus_behavior.ipam_filter_pools(current_user, pools)


# literaler Pfad VOR /pools/{pool_id}, sonst matcht "by-network" als pool_id
@router.get("/pools/by-network", response_model=list[IpPoolResponse])
async def pools_by_network(
    kind: str = Query(..., pattern="^(bridge|vnet)$"),
    network_name: str = Query(..., min_length=1),
    node: Optional[str] = Query(None),
    vlan_tag: Optional[int] = Query(None, ge=1, le=4094),
    current_user: CurrentUser = Depends(require_not_restricted),
    __=_SCOPE_READ,
):
    """Pools eines konkreten Netzes (Deploy-Auflösung: 0/1/>1 Pool → Feld/Auto/Picker)."""
    pools = await service.pools_for_network(kind, network_name, node, vlan_tag)
    # PROJ-42 Phase 2: Pool-Sicht erbt die Netz-Freigaben (Plus, strict).
    from backend.core.plus_protocol import plus_behavior
    return await plus_behavior.ipam_filter_pools(current_user, pools)


@router.get("/pools/{pool_id}", response_model=IpPoolResponse)
async def get_pool(
    pool_id: int, _: CurrentUser = Depends(_manage), __=_SCOPE_READ
):
    pool = await service.get_pool(pool_id)
    if pool is None:
        raise HTTPException(status_code=404, detail="pool_not_found")
    return pool


@router.put("/pools/{pool_id}", response_model=IpPoolResponse)
async def update_pool(
    pool_id: int,
    body: IpPoolUpdateRequest,
    current_user: CurrentUser = Depends(_manage),
    __=_SCOPE_WRITE,
):
    try:
        pool = await service.update_pool(pool_id, body, updated_by=current_user.username)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if pool is None:
        raise HTTPException(status_code=404, detail="pool_not_found")
    return pool


@router.delete("/pools/{pool_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pool(
    pool_id: int, _: CurrentUser = Depends(_manage), __=_SCOPE_WRITE
):
    # PROJ-42 Phase 2: harter Block, wenn der Pool aktive Allocations hat (Plus).
    # Core-Default = no-op → Pool immer löschbar. Wirft 409 statt still zu verwaisen.
    from backend.core.plus_protocol import plus_behavior
    await plus_behavior.ipam_assert_pool_deletable(pool_id)
    ok = await service.delete_pool(pool_id)
    if not ok:
        raise HTTPException(status_code=404, detail="pool_not_found")


# ── best-effort Free-IP-Vorschlag ─────────────────────────────────────────────

@router.get("/suggest", response_model=SuggestResponse)
async def suggest(
    pool_id: int = Query(...),
    current_user: CurrentUser = Depends(require_not_restricted),
    __=_SCOPE_READ,
):
    used = await collect_used_ipv4s(current_user)
    # PROJ-42 Phase 2: reservierte Allocation-IPs (Plus) zur belegten Menge addieren,
    # damit der Vorschlag keine bereits reservierte IP anbietet. Core-Default = ∅.
    try:
        from backend.core.plus_protocol import plus_behavior
        used |= await plus_behavior.ipam_reserved_ips(pool_id)
    except Exception:
        pass
    result = await service.suggest_free_ip(pool_id, used)
    if result is None:
        raise HTTPException(status_code=404, detail="pool_not_found")
    return result
