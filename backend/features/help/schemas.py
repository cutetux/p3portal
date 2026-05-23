# p3portal.org
"""PROJ-57: Pydantic-Schemas für die Help-Override-API."""
from __future__ import annotations

from pydantic import BaseModel


class HelpOverrideResponse(BaseModel):
    """Basis-Response für einen Hilfe-Override (User- oder Global-Scope)."""
    id: int
    key: str
    lang: str
    scope: str                    # "user" | "global"
    content: str
    content_md5: str
    owner_user_id: int | None
    original_uploader_user_id: int | None
    created_at: str
    updated_at: str


class HelpAdminOverrideResponse(HelpOverrideResponse):
    """Erweiterte Response für den Admin-Tab (inkl. Uploader-Username)."""
    owner_username: str | None = None
    original_uploader_username: str | None = None


class HelpMyOverrideResponse(BaseModel):
    """Schlanke Response für den MyAccount-Tab 'Meine Hilfetexte'."""
    id: int
    key: str
    lang: str
    content_md5: str
    created_at: str
    updated_at: str


class HelpPromoteResponse(BaseModel):
    """Response nach erfolgreicher Promote-Operation."""
    global_override_id: int
    key: str
    lang: str
    content_md5: str


class HelpDeleteResponse(BaseModel):
    """Response nach erfolgreichem Löschen."""
    deleted_id: int
    message: str
