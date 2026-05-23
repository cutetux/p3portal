# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Pydantic Request/Response-Schemas für Git-Sync."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


RepoType = Literal["ansible", "packer"]
AuthMethod = Literal["https", "ssh"]
SyncStatus = Literal["running", "success", "failed"]
TriggeredBy = Literal["manual", "scheduled_job", "webhook"]
Resolution = Literal["git", "local"]


# ── Config Request / Response ─────────────────────────────────────────────────

class GitSyncConfigUpdate(BaseModel):
    """PUT /api/git-sync/config/{repo_type}"""
    enabled: bool = False
    repo_url: str = Field(default="", max_length=512)
    branch: str = Field(default="main", max_length=128)
    subdir: Optional[str] = Field(default=None, max_length=256)
    auth_method: AuthMethod = "https"
    https_username: Optional[str] = Field(default=None, max_length=128)
    https_token: Optional[str] = Field(default=None)     # Klartext, wird verschlüsselt
    auto_sync_interval: int = Field(default=0, ge=0)     # 0=disabled, Minuten (5/15/30/60)

    @field_validator("auto_sync_interval")
    @classmethod
    def validate_interval(cls, v: int) -> int:
        allowed = {0, 5, 15, 30, 60}
        if v not in allowed:
            raise ValueError(f"auto_sync_interval muss aus {allowed} sein")
        return v

    @field_validator("repo_url")
    @classmethod
    def validate_repo_url(cls, v: str) -> str:
        if v and not (v.startswith("https://") or v.startswith("http://") or v.startswith("git@") or v.startswith("ssh://")):
            raise ValueError("repo_url muss mit https://, http://, git@ oder ssh:// beginnen")
        return v


class GitSyncConfigResponse(BaseModel):
    """GET /api/git-sync/config/{repo_type} – Token zensiert"""
    id: Optional[int] = None
    repo_type: RepoType
    enabled: bool
    repo_url: str
    branch: str
    subdir: Optional[str]
    auth_method: AuthMethod
    https_username: Optional[str]
    has_https_token: bool      # True wenn Token gesetzt (Klartext nie ausgegeben)
    ssh_public_key: Optional[str]
    has_webhook_token: bool    # True wenn Token gesetzt
    auto_sync_interval: int
    updated_at: Optional[str]
    updated_by: Optional[str]


# ── Sync Log ──────────────────────────────────────────────────────────────────

class GitSyncLogEntry(BaseModel):
    id: int
    repo_type: RepoType
    triggered_by: TriggeredBy
    started_at: str
    completed_at: Optional[str]
    status: SyncStatus
    items_synced: int
    items_conflicted: int
    message: Optional[str]
    log_detail: Optional[str]


# ── Conflict ──────────────────────────────────────────────────────────────────

class GitSyncConflict(BaseModel):
    id: int
    repo_type: RepoType
    item_id: str
    git_hash: str
    detected_at: str
    resolved_at: Optional[str]
    resolution: Optional[Resolution]
    resolved_by: Optional[str]


class ConflictResolveRequest(BaseModel):
    resolution: Resolution


# ── Sync Trigger Response ──────────────────────────────────────────────────────

class SyncTriggerResponse(BaseModel):
    status: Literal["started", "queued"]
    message: str


# ── SSH-Key Response ──────────────────────────────────────────────────────────

class SshPublicKeyResponse(BaseModel):
    public_key: str
    repo_type: RepoType


# ── Webhook Token Response ────────────────────────────────────────────────────

class WebhookTokenResponse(BaseModel):
    webhook_url_template: str   # z.B. /api/git-sync/webhook/ansible/{token}
    repo_type: RepoType
