# p3portal.org
"""PROJ-57: Cleanup-Hooks für das Help-Override-System.

User-Delete:
  - Eigene User-Overrides: via FK CASCADE automatisch gelöscht (DB-Ebene).
  - original_uploader_user_id in globalen Overrides: via FK ON DELETE SET NULL
    erhalten (Audit-Spur bleibt, Override bleibt aktiv).
  - Kein manueller Cleanup nötig – FK-Constraints erledigen das.

Orphan-Detection (verwaiste Overrides für deprecated Help-Keys):
  - Client-seitig im Frontend: HelpAdminSection filtert
    overrides.filter(o => !registry.has(o.key)) als „Verwaiste Einträge".
  - Bulk-Delete via DELETE /api/help/overrides/{id} (Loop) oder direkt hier.

Diese Datei stellt eine Hilfsfunktion für zukünftige Bulk-Operationen bereit.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


async def purge_orphan_overrides(
    *,
    valid_keys: set[str],
    admin_username: str,
) -> int:
    """Löscht alle Overrides für Keys, die nicht mehr in der Registry stehen.

    Wird vom Admin-Bulk-Delete-Button in HelpAdminSection ausgelöst.
    Audit-Event: help_orphan_overrides_purged

    Returns:
        Anzahl der gelöschten Datensätze.
    """
    async with get_db() as db:
        result = await db.execute(
            text("SELECT id, key FROM help_overrides"),
        )
        all_overrides = result.fetchall()

        orphan_ids = [row[0] for row in all_overrides if row[1] not in valid_keys]
        orphan_keys = list({row[1] for row in all_overrides if row[1] not in valid_keys})

        if not orphan_ids:
            return 0

        for oid in orphan_ids:
            await db.execute(
                text("DELETE FROM help_overrides WHERE id = :id"),
                {"id": oid},
            )
        await db.commit()

    await write_audit_log(
        event_type="help_orphan_overrides_purged",
        username=admin_username,
        detail=f'{{"count": {len(orphan_ids)}, "keys": {orphan_keys}}}',
    )

    logger.info("Purged %d orphan help overrides: %s", len(orphan_ids), orphan_keys)
    return len(orphan_ids)
