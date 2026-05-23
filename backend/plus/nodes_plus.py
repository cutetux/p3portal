# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-43 Session 3: Plus-Logik für Multi-Node-Verwaltung.

In der Core-Edition kann nur ein einziger Proxmox-Node verwaltet werden.
Plus aktiviert sowohl das Hinzufügen weiterer Nodes als auch das Wechseln
des Default-Nodes.

Wird über Mixin-Komposition in `PlusActiveBehavior` (hooks.py) eingebunden.
"""
from __future__ import annotations


class NodesPlusBehavior:
    """Plus-Verhalten für Multi-Node-Features."""

    def can_add_multiple_nodes(self) -> bool:
        return True

    def can_set_default_node(self) -> bool:
        return True
