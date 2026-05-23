# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Pydantic-Schemas für den Approval-Workflow."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ── approval_rules ────────────────────────────────────────────────────────────

class ApprovalRuleBase(BaseModel):
    action_type: str
    action_target: str = "*"
    required: bool = False
    approver_groups: list[int] = Field(default_factory=list)
    approver_users: list[int] = Field(default_factory=list)
    expiration_hours: int = Field(default=48, ge=1, le=168)
    allow_self_approval: bool = False
    is_active: bool = True


class ApprovalRuleCreate(ApprovalRuleBase):
    pass


class ApprovalRuleUpdate(BaseModel):
    required: bool | None = None
    approver_groups: list[int] | None = None
    approver_users: list[int] | None = None
    expiration_hours: int | None = Field(default=None, ge=1, le=168)
    allow_self_approval: bool | None = None
    is_active: bool | None = None


class ApprovalRuleResponse(ApprovalRuleBase):
    id: int
    source: str          # meta_yaml | ui_override
    meta_yaml_snapshot: dict | None = None
    created_at: str
    updated_at: str
    updated_by_user_id: int | None = None
    active_count: int = 0  # Anzahl pending Anträge für diese Regel


# ── pending_approvals ─────────────────────────────────────────────────────────

class ApprovalResponse(BaseModel):
    id: str
    action_type: str
    action_target: str
    payload: dict[str, Any]          # secrets bereits maskiert
    payload_hash: str
    requester_user_id: int | None
    requester_username: str | None = None
    requested_at: str
    expires_at: str
    status: str
    decided_by_user_id: int | None = None
    decided_by_username: str | None = None
    decided_at: str | None = None
    decided_reason: str | None = None
    self_approval: bool = False
    job_id: str | None = None
    parent_approval_id: str | None = None
    rule_snapshot: dict[str, Any]
    can_approve: bool = False         # wird vom Router per can_user_approve() gesetzt
    is_own_request: bool = False      # wird vom Router gesetzt


class ApprovalListResponse(BaseModel):
    items: list[ApprovalResponse]
    total: int


class ApproveRequest(BaseModel):
    reason: str | None = None


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=10)


class ResubmitRequest(BaseModel):
    payload_overrides: dict[str, Any] = Field(default_factory=dict)


# ── portal-config/approval-workflow ──────────────────────────────────────────

class ApprovalWorkflowConfig(BaseModel):
    enabled: bool
    default_approver_group_id: int | None = None
    default_expiration_hours: int = 48
    allow_self_approval_global: bool = False
    max_approval_rules: int | None = None       # None = unlimitiert (Plus)
    allow_self_approval_supported: bool = False  # Core False / Plus True


class ApprovalWorkflowToggle(BaseModel):
    enabled: bool
    default_approver_group_id: int | None = None
    default_expiration_hours: int | None = None
    allow_self_approval_global: bool | None = None


class ApprovalCountResponse(BaseModel):
    count: int
