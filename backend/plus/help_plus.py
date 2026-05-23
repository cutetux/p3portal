# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-57: Plus-Logik für das P3-Handbuch-System.

In der Core-Edition:
- max. CORE_MAX_HELP_OVERRIDES_PER_USER (10) persönliche Overrides pro User
- 0 globale Overrides (Admin-Promote ist Plus-only)

Plus hebt beide Limits auf (None = unbegrenzt).
"""
from __future__ import annotations


class HelpPlusBehavior:
    """Plus-Verhalten: unbegrenzte Hilfe-Overrides."""

    def get_max_help_overrides_per_user(self) -> int | None:
        return None

    def get_max_help_global_overrides(self) -> int | None:
        return None
