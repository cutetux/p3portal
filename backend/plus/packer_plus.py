# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-43 Session 4: Plus-Logik für Packer Multi-Node-Sicht.

Core-Edition betreibt Packer immer auf dem konfigurierten `PROXMOX_NODE`
und listet daher nur diesen einen Node bzw. dessen VMs.
Plus aktiviert die cluster-weite Sicht: alle Nodes, alle Templates eines
Clusters über `/cluster/resources`.

Wird über Mixin-Komposition in `PlusActiveBehavior` (hooks.py) eingebunden.
"""
from __future__ import annotations


class PackerPlusBehavior:
    """Plus-Verhalten für Packer-Cluster-Sicht."""

    def can_use_cluster_resources(self) -> bool:
        return True
