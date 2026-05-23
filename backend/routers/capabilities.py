# p3portal.org
"""PROJ-60: GET /api/capabilities – Editions-Capabilities für das Frontend.

PROJ-67 Phase 1 – F-017: Auth-Gate hinzugefügt (Depends(get_current_user)).
Liefert ein flaches JSON-Objekt mit allen Capability-Flags, z.B.:
    { "alert_presets": false, "theme_editor": true, ... }

Frontend cached die Antwort via React Query (staleTime: Infinity).
Lizenz-Upload muss queryClient.invalidateQueries(['capabilities']) auslösen.
"""
from fastapi import APIRouter, Depends

from backend.core.plus_protocol import CAPABILITIES, plus_behavior
from backend.core.deps import get_current_user, CurrentUser

router = APIRouter(tags=["capabilities"])


@router.get("/api/capabilities")
async def get_capabilities(
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    """Liefert alle editions-spezifischen Capability-Flags.

    PROJ-67 Phase 1 – F-017: Erfordert gültigen JWT.
    Enthält zusätzlich `extra_portal_permissions`: Liste der Plus-only Portal-Permissions
    (PROJ-63 AC-CAPABILITIES-2), z.B. ["manage_playbook_permissions"].
    Alle CAPABILITIES-Methoden sind sync; der Master-Toggle-Status kommt separat
    via GET /api/admin/approval-workflow.
    """
    caps: dict = {}
    for key, method_name in CAPABILITIES.items():
        result = getattr(plus_behavior, method_name)()
        caps[key] = bool(result)
    caps["extra_portal_permissions"] = plus_behavior.get_extra_portal_permissions()
    return caps
