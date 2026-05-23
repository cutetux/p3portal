# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-43 Session 2: Plus-Logik für VM/LXC Alerting.

Aggregiert alle Plus-only Verhalten rund um Alerts:
- Presets, SMTP, Threshold-Overrides (Gate)
- Notification-Felder (webhook_url/token, email_recipients) durchreichen

Wird über Mixin-Komposition in `PlusActiveBehavior` (hooks.py) eingebunden.
Core-Edition nutzt weiterhin die Stubs aus `PlusBehavior`.
"""
from __future__ import annotations


class AlertsPlusBehavior:
    """Plus-Verhalten für Alert-Features.

    Inheritance-Reihenfolge in PlusActiveBehavior stellt sicher, dass diese
    Methoden die `PlusBehavior`-Stubs überschreiben.
    """

    def can_use_alert_presets(self) -> bool:
        return True

    def filter_alert_notification_fields(self, fields: dict) -> dict:
        """Plus: Notification-Felder unverändert durchreichen."""
        return dict(fields)
