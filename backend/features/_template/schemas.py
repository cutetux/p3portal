# p3portal.org
"""PROJ-XX: Pydantic-v2 Request/Response-Schemas für das FEATURE-Modul."""
from __future__ import annotations

from pydantic import BaseModel


class FEATURECreateRequest(BaseModel):
    name: str


class FEATUREResponse(BaseModel):
    id: int
    name: str
