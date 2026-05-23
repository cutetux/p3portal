# p3portal.org
"""PROJ-65: Notification Hub Pydantic-Schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class NotificationLink(BaseModel):
    """Navigation-Ziel beim Klick auf einen Eintrag."""
    route: str
    modal: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class NotificationItem(BaseModel):
    """Vereinheitlichtes Schema für alle Notification-Quellen."""
    source: Literal["alert", "announcement", "event"]
    source_id: str
    severity: Literal["critical", "warn", "info", "success"]
    title: str
    summary: str | None = None
    created_at: datetime
    read: bool = False
    link: NotificationLink
    meta: dict[str, Any] = Field(default_factory=dict)


class NotificationSummary(BaseModel):
    """Kompakt-Antwort für Header-Badge und Glocken-Farbe."""
    alerts: int = 0
    announcements: int = 0
    events: int = 0
    total: int = 0
    max_severity: Literal["critical", "warn", "info"] | None = None


class MarkReadRequest(BaseModel):
    source: Literal["alert", "announcement", "event"]
    source_ids: list[str] = Field(min_length=1, max_length=200)


class MarkReadResponse(BaseModel):
    marked: int
