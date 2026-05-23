# p3portal.org
"""PROJ-48: Pydantic-Schemas für das Owners-Modul."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator


class OwnerEntry(BaseModel):
    id: int
    resource_type: str
    node_id: int
    vmid: int
    user_id: int
    username: str | None = None
    assigned_at: str
    assigned_by_user_id: int | None = None
    assigned_by_username: str | None = None
    source: str


class OwnerListResponse(BaseModel):
    owners: list[OwnerEntry]


class AddCoOwnerRequest(BaseModel):
    user_id: int


class TransferOwnerRequest(BaseModel):
    to_user_id: int


class DeleteOwnerParams(BaseModel):
    orphan: bool = False


class AdoptRequest(BaseModel):
    pass


class DeleteRequestBody(BaseModel):
    reason: str | None = None


class DeleteRequestResponse(BaseModel):
    id: int
    resource_type: str
    node_id: int
    vmid: int
    requested_by_user_id: int
    requested_at: str
    reason: str | None = None
    status: str


class BulkOwnerItem(BaseModel):
    resource_type: str
    node_id: int
    vmid: int


class BulkOwnerRequest(BaseModel):
    resources: list[BulkOwnerItem]

    @field_validator("resources")
    @classmethod
    def limit_resources(cls, v: list) -> list:
        if len(v) > 500:
            raise ValueError("Maximal 500 Ressourcen pro Bulk-Anfrage")
        return v


class BulkOwnerEntry(BaseModel):
    resource_type: str
    node_id: int
    vmid: int
    owners: list[OwnerEntry]


class MyResourceEntry(BaseModel):
    id: int
    resource_type: str
    node_id: int
    node_name: str | None = None
    vmid: int
    assigned_at: str
    source: str


class UserDeleteOwnershipAction(BaseModel):
    action: Literal["transfer", "orphan"]
    transfer_to_user_id: int | None = None

    @field_validator("transfer_to_user_id")
    @classmethod
    def transfer_requires_target(cls, v: int | None, info) -> int | None:
        action = info.data.get("action")
        if action == "transfer" and v is None:
            raise ValueError("transfer_to_user_id ist Pflicht bei action=transfer")
        return v
