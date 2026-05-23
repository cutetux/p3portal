# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-46: Pydantic-Schemas für das Pools-Modul."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator


def _validate_name(v: str) -> str:
    v = v.strip()
    if len(v) < 2:
        raise ValueError("Poolname muss mindestens 2 Zeichen lang sein")
    if len(v) > 64:
        raise ValueError("Poolname darf maximal 64 Zeichen lang sein")
    return v


def _validate_tags(v: list[str]) -> list[str]:
    if len(v) > 10:
        raise ValueError("Maximal 10 Tags pro Pool erlaubt")
    result: list[str] = []
    seen: set[str] = set()
    for tag in v:
        tag = tag.strip()
        if len(tag) > 32:
            raise ValueError("Ein Tag darf maximal 32 Zeichen lang sein")
        lower = tag.lower()
        if lower not in seen:
            seen.add(lower)
            result.append(tag)
    return result


class PoolCreateRequest(BaseModel):
    name: str
    description: str | None = None
    tags: list[str] = []
    owner_subject_type: Literal["user", "group"] | None = None
    owner_subject_id: int | None = None
    cpu_quota: int = 0
    ram_quota_mb: int = 0
    disk_quota_gb: int = 0
    vm_count_quota: int = 0

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _validate_name(v)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        return _validate_tags(v)

    @field_validator("cpu_quota", "ram_quota_mb", "disk_quota_gb", "vm_count_quota")
    @classmethod
    def validate_quota(cls, v: int) -> int:
        if v < 0:
            raise ValueError("Quota darf nicht negativ sein")
        return v


class PoolUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    owner_subject_type: Literal["user", "group"] | None = None
    owner_subject_id: int | None = None
    clear_owner: bool = False
    cpu_quota: int | None = None
    ram_quota_mb: int | None = None
    disk_quota_gb: int | None = None
    vm_count_quota: int | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_name(v)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return _validate_tags(v)

    @field_validator("cpu_quota", "ram_quota_mb", "disk_quota_gb", "vm_count_quota")
    @classmethod
    def validate_quota(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("Quota darf nicht negativ sein")
        return v


# ── Members ───────────────────────────────────────────────────────────────────

class PoolMemberAddRequest(BaseModel):
    resource_type: Literal["vm", "lxc"]
    node_id: int
    vmid: int


class PoolMemberBulkAddRequest(BaseModel):
    members: list[PoolMemberAddRequest]


class PoolMemberResponse(BaseModel):
    id: int
    pool_id: int
    resource_type: str
    node_id: int
    vmid: int
    added_at: str
    added_by: str


# ── Assignments ───────────────────────────────────────────────────────────────

class PoolAssignmentAddRequest(BaseModel):
    subject_type: Literal["user", "group"]
    subject_id: int
    role_preset_id: int


class PoolAssignmentResponse(BaseModel):
    id: int
    pool_id: int
    subject_type: str
    subject_id: int
    role_preset_id: int
    role_preset_name: str | None
    added_at: str
    added_by: str


# ── Quota usage ───────────────────────────────────────────────────────────────

class QuotaUsage(BaseModel):
    used: int
    quota: int  # 0 = unlimited


class PoolUsageResponse(BaseModel):
    pool_id: int
    vm_count: QuotaUsage
    cpu: QuotaUsage
    ram_mb: QuotaUsage
    disk_gb: QuotaUsage
    template_count: int
    is_over_quota: bool


# ── Pool responses ────────────────────────────────────────────────────────────

class PoolResponse(BaseModel):
    id: int
    name: str
    description: str | None
    tags: list[str]
    owner_subject_type: str | None
    owner_subject_id: int | None
    cpu_quota: int
    ram_quota_mb: int
    disk_quota_gb: int
    vm_count_quota: int
    member_count: int
    assignment_count: int
    created_at: str
    created_by: str


class PoolDetailResponse(PoolResponse):
    members: list[PoolMemberResponse]
    assignments: list[PoolAssignmentResponse]
    usage: PoolUsageResponse | None = None


# ── Pool move VM ─────────────────────────────────────────────────────────────

class VmPoolMoveRequest(BaseModel):
    pool_id: int | None = None  # None = remove from pool


# ── Tags ──────────────────────────────────────────────────────────────────────

class TagsPoolResponse(BaseModel):
    tags: list[str]


# ── My pools ─────────────────────────────────────────────────────────────────

class MyPoolEntry(BaseModel):
    id: int
    name: str
    role_preset_id: int
    role_preset_name: str | None


# ── Pool delete preview ───────────────────────────────────────────────────────

class PoolDeletePreview(BaseModel):
    pool_id: int
    name: str
    member_count: int
    assignment_count: int
