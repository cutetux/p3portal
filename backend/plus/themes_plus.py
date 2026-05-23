# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-43 Session 3: Plus-Logik für den Theme-Editor.

Aktiviert das Theme-Editor-Gate. Core-Edition kann Themes nur listen und
auswählen; Erstellen/Hochladen/Bearbeiten ist Plus-only.

Wird über Mixin-Komposition in `PlusActiveBehavior` (hooks.py) eingebunden.
"""
from __future__ import annotations


class ThemesPlusBehavior:
    """Plus-Verhalten für den Theme-Editor."""

    def can_use_theme_editor(self) -> bool:
        return True
