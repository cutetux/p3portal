# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Git-Sync Plus-Mixin – aktiviert can_use_git_sync()."""
from __future__ import annotations


class GitSyncPlusBehavior:
    def can_use_git_sync(self) -> bool:
        return True
