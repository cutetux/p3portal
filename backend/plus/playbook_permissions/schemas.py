# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-49: Pydantic-Schemas für Playbook-Permissions."""
from __future__ import annotations

from pydantic import BaseModel


class PlaybookPermissionEntry(BaseModel):
    id: int
    playbook_name: str
    subject_type: str
    subject_id: int
    subject_label: str
    added_at: str
    added_by_user_id: int | None
    added_by_username: str | None


class AddPermissionRequest(BaseModel):
    subject_type: str   # 'user' | 'group'
    subject_id: int


class PlaybookPermissionConfig(BaseModel):
    default_playbook_mode: str   # 'open' | 'restricted'


class UpdateConfigRequest(BaseModel):
    default_playbook_mode: str   # 'open' | 'restricted'


class AllowedPlaybook(BaseModel):
    playbook_name: str
    category: str | None
    source: str   # 'direct' | 'group:<name>' | 'default_mode_open' | 'admin'
