# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-43 Session 5: Plus-Logik für das Multi-Node-Dashboard.

Aktiviert die cluster-weite Sicht in `routers/cluster.py`:

- Lokale Nutzer: Fan-Out über alle konfigurierten Portal-Nodes (PROJ-30).
- Proxmox-Login-Nutzer: Cluster-weite Reads via `/cluster/resources`/`/cluster/status`.

Core-Edition liest immer nur den einen `PROXMOX_NODE`.

Wird über Mixin-Komposition in `PlusActiveBehavior` (hooks.py) eingebunden.
"""
from __future__ import annotations


class ClusterPlusBehavior:
    """Plus-Verhalten für das Multi-Node-Dashboard."""

    def can_use_multi_node_dashboard(self) -> bool:
        return True
