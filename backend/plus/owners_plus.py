# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-48: Plus-Logik für Owner-Auto-Assignment.

In der Core-Edition sind maximal CORE_MAX_OWNERSHIPS (10) aktive Owner-Einträge
pro User erlaubt. Plus hebt dieses Limit auf (None = unbegrenzt).
"""
from __future__ import annotations


class OwnersPlusBehavior:
    """Plus-Verhalten: unbegrenzte Owner-Einträge."""

    def get_max_ownerships(self) -> int | None:
        return None
