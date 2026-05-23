# p3portal.org
"""PROJ-66: Lifespan-Helper für den ersten Tooling-Health-Check.

Wird aus main.py aufgerufen NACH ensure_plus_db_tables() (Tech-Design §F).
Fire-and-forget via asyncio.create_task – blockiert Backend-Start nicht.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


def register_startup_check() -> None:
    """Startet den ersten Tool-Health-Check asynchron als Background-Task.

    Bis der Check abgeschlossen ist (~2-3 s), liefert /status 'unknown'.
    """
    from backend.features.tooling.service import tooling_service

    async def _run() -> None:
        try:
            await tooling_service.run_all_checks()
            logger.info("PROJ-66: Initialer Tooling-Health-Check abgeschlossen")
        except Exception as exc:
            logger.warning("PROJ-66: Initialer Tooling-Health-Check fehlgeschlagen: %s", exc)

    asyncio.create_task(_run())
    logger.info("PROJ-66: Tooling-Health-Check im Hintergrund gestartet")
