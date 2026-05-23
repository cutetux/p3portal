# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-43 Session 4: Plus-Logik für Limits & Custom-Languages.

Bündelt vier eher kleine Plus-Verhalten, die jeweils nur einen Hook
überschreiben:
- `get_max_users`     – PROJ-20 User-Limit aufheben (None = unbegrenzt)
- `get_max_presets`   – PROJ-20 Preset-Limit aufheben (None = unbegrenzt)
- `can_change_language` – PROJ-18 Custom-Language-Upload freigeben
- `get_max_api_keys`  – PROJ-24 Per-User-API-Key-Limit aktivieren

Wird über Mixin-Komposition in `PlusActiveBehavior` (hooks.py) eingebunden.
"""
from __future__ import annotations


class MiscPlusBehavior:
    """Plus-Verhalten für Limits, i18n-Upload und User-API-Key-Limits."""

    def get_max_users(self) -> int | None:
        return None

    def get_max_presets(self) -> int | None:
        return None

    def can_change_language(self) -> bool:
        return True

    def get_max_api_keys(self, user: dict) -> int:
        from backend.services.user_api_key_service import DEFAULT_PLUS_MAX_KEYS

        custom = user.get("api_keys_max_count")
        return int(custom) if custom is not None else DEFAULT_PLUS_MAX_KEYS

    def get_max_groups(self) -> int | None:
        return None

    def get_max_pools(self) -> int | None:
        return None

    def get_max_node_assignments(self) -> int | None:
        return None

    def get_max_sidebar_pins(self) -> int:
        """PROJ-54: Plus hat kein hartes Limit bis PLUS_HARD_MAX_PINS (25).
        Rückgabe PLUS_SOFT_WARN_PINS (10) – Frontend zeigt Toast über 10, Router blockiert bei 25."""
        from backend.core.license import PLUS_SOFT_WARN_PINS
        return PLUS_SOFT_WARN_PINS
