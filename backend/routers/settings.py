# p3portal.org
from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.core.deps import get_current_user
from backend.services.settings_service import get_setting

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/ssh-key")
async def get_ssh_key(_: str = Depends(get_current_user)) -> dict:
    key = await get_setting("ssh_key")
    return {"key": key}
