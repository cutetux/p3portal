# p3portal.org
"""PROJ-XX: FastAPI-Router für das FEATURE-Modul.

Prefix und Tags werden hier definiert und in main.py via
  app.include_router(router)
eingehängt (kein separater prefix-Parameter in main.py nötig).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from backend.core.deps import CurrentUser, get_current_user
from .schemas import FEATURECreateRequest, FEATUREResponse
from . import service

router = APIRouter(prefix="/api/features", tags=["features"])


@router.get("", response_model=list[FEATUREResponse])
async def list_features(current_user: CurrentUser = Depends(get_current_user)):
    """Alle FEATURE-Objekte auflisten."""
    # TODO: implement
    return []


@router.post("", response_model=FEATUREResponse, status_code=status.HTTP_201_CREATED)
async def create_feature(
    body: FEATURECreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Neues FEATURE-Objekt erstellen."""
    return await service.create_feature(body.name)


@router.get("/{feature_id}", response_model=FEATUREResponse)
async def get_feature(
    feature_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    """FEATURE-Objekt per ID abrufen."""
    obj = await service.get_feature(feature_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return obj
