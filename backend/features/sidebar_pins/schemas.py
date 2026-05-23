# p3portal.org
"""PROJ-54: Pydantic-Schemas für das Sidebar-Pins-Modul."""
from __future__ import annotations

import re

from pydantic import BaseModel, field_validator

_ROUTE_PATTERN = re.compile(r"^/[a-zA-Z0-9/_?=&\-.]*$")
_LABEL_FORBIDDEN = re.compile(r"[<>&\"']")

PIN_KINDS = frozenset(
    {
        "system_settings_tab",
        "system_settings_sub_tab",
        "vm",
        "lxc",
        "node",
        "node_tab",
        "pool",
        "group",
        "other",
    }
)


def _validate_route(v: str) -> str:
    v = v.strip()
    if len(v) > 200:
        raise ValueError("Route darf maximal 200 Zeichen lang sein")
    if not _ROUTE_PATTERN.match(v):
        raise ValueError(
            "Ungültige Route – erlaubt sind nur interne Pfade "
            r"(Pattern: ^/[a-zA-Z0-9/_?=&\-.]*$)"
        )
    return v


def _validate_label(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if v == "":
        return None
    if len(v) > 40:
        raise ValueError("Label darf maximal 40 Zeichen lang sein")
    if _LABEL_FORBIDDEN.search(v):
        raise ValueError("Label enthält ungültige Zeichen (< > & \" ')")
    return v


class PinCreateRequest(BaseModel):
    route: str
    label: str | None = None
    pin_kind: str = "other"
    resource_ref: str | None = None

    @field_validator("route")
    @classmethod
    def validate_route(cls, v: str) -> str:
        return _validate_route(v)

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: str | None) -> str | None:
        return _validate_label(v)

    @field_validator("pin_kind")
    @classmethod
    def validate_pin_kind(cls, v: str) -> str:
        if v not in PIN_KINDS:
            raise ValueError(f"Ungültiger pin_kind. Erlaubt: {', '.join(sorted(PIN_KINDS))}")
        return v


class PinUpdateRequest(BaseModel):
    label: str | None = None

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: str | None) -> str | None:
        return _validate_label(v)


class ReorderRequest(BaseModel):
    pin_ids: list[int]


class PinResponse(BaseModel):
    id: int
    user_id: int
    route: str
    label: str | None
    position: int
    pin_kind: str
    resource_ref: str | None
    created_at: str


class PinCreateResponse(BaseModel):
    pin: PinResponse
    warning: str | None = None
