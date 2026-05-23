# p3portal.org
"""PROJ-XX: pytest-Tests für den FEATURE-Service.

Testet Business-Logik isoliert von HTTP-Schicht.
DB-Calls werden mit AsyncMock gepatcht.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_get_feature_not_found():
    """get_feature() gibt None zurück wenn kein Eintrag existiert."""
    mock_cursor = MagicMock()
    mock_cursor.fetchone = AsyncMock(return_value=None)

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_cursor)
    mock_db.__aenter__ = AsyncMock(return_value=mock_db)
    mock_db.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.features._template.service.get_db", return_value=mock_db):
        from backend.features._template.service import get_feature
        result = await get_feature(999)

    assert result is None
