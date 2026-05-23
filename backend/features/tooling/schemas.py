# p3portal.org
"""PROJ-66: Pydantic-Schemas für die Tooling-Health-API."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


class ToolCheckConfig(BaseModel):
    """Konfiguration für einen Tool-Health-Check (Core hardcoded + Plus-Hook-Erweiterung)."""
    tool_id: str          # z.B. "ansible", "packer", "terraform"
    display_name: str     # Anzeigename in der Topbar
    version_cmd: list[str]  # z.B. ["ansible", "--version"]
    probe_cmd: list[str]    # z.B. ["ansible", "all", "-i", "localhost,", "-m", "ping", ...]


class ToolStatus(BaseModel):
    """In-Memory-Zustand eines Tools (nicht persistiert, außer Audit bei Transition)."""
    tool: str
    version: str | None = None
    status: Literal["ready", "degraded", "down", "unknown"] = "unknown"
    last_check: datetime | None = None
    stdout: str | None = None
    stderr: str | None = None


class ToolingStatusResponse(BaseModel):
    """Response-Schema für GET /api/system/tooling/status."""
    model_config = ConfigDict(extra="allow")

    ansible: ToolStatus
    packer: ToolStatus


class RecheckResponse(BaseModel):
    """Response für POST /api/system/tooling/recheck."""
    model_config = ConfigDict(extra="allow")

    ansible: ToolStatus
    packer: ToolStatus


class AuditHistoryItem(BaseModel):
    """Ein Eintrag in der Tool-Status-Transitions-Historie."""
    id: int
    created_at: str
    tool: str
    from_status: str
    to_status: str
    version: str | None
    stderr_excerpt: str | None


class AuditHistoryResponse(BaseModel):
    """Response für GET /api/system/tooling/audit-history."""
    tool: str
    items: list[AuditHistoryItem]
    total: int
