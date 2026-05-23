# p3portal.org
"""PROJ-35: Pydantic-Schemas für Scheduled Jobs."""
from __future__ import annotations

import re
from typing import Any, Optional

from pydantic import BaseModel, field_validator


# ── Cron-Hilfsfunktionen ─────────────────────────────────────────────────────

PRESET_INTERVALS: dict[str, str] = {
    "15min":   "*/15 * * * *",
    "hourly":  "0 * * * *",
    "daily":   "0 0 * * *",
    "weekly":  "0 0 * * 0",
}

_CRON_RE = re.compile(
    r"^(\*|[0-9,\-\*/]+)\s+"
    r"(\*|[0-9,\-\*/]+)\s+"
    r"(\*|[0-9,\-\*/]+)\s+"
    r"(\*|[0-9,\-\*/]+)\s+"
    r"(\*|[0-9,\-\*/]+)$"
)


def validate_cron(expr: str) -> str:
    """Prüft Cron-Syntax – wirft ValueError bei ungültigem Ausdruck."""
    expr = expr.strip()
    if not _CRON_RE.match(expr):
        raise ValueError(f"Ungültiger Cron-Ausdruck: '{expr}'")
    return expr


# ── Request-Schemas ───────────────────────────────────────────────────────────

class ScheduledJobCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    job_type: str                    # playbook | ssh | power_action
    cron_expression: str
    active: bool = True
    config: dict[str, Any] = {}

    # Zeitfenster-Modus (Power-Action only)
    window_mode: bool = False
    window_stop_cron: Optional[str] = None
    window_stop_config: Optional[dict[str, Any]] = None

    @field_validator("job_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ("playbook", "ssh", "power_action"):
            raise ValueError("job_type muss 'playbook', 'ssh' oder 'power_action' sein")
        return v

    @field_validator("cron_expression")
    @classmethod
    def valid_cron(cls, v: str) -> str:
        return validate_cron(v)

    @field_validator("window_stop_cron")
    @classmethod
    def valid_stop_cron(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return validate_cron(v)
        return v


class ScheduledJobUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    cron_expression: Optional[str] = None
    active: Optional[bool] = None
    config: Optional[dict[str, Any]] = None

    window_mode: Optional[bool] = None
    window_stop_cron: Optional[str] = None
    window_stop_config: Optional[dict[str, Any]] = None

    @field_validator("cron_expression")
    @classmethod
    def valid_cron(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return validate_cron(v)
        return v

    @field_validator("window_stop_cron")
    @classmethod
    def valid_stop_cron(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return validate_cron(v)
        return v


# ── Response-Schemas ──────────────────────────────────────────────────────────

class ScheduledJobRunResponse(BaseModel):
    id: str
    job_id: str
    started_at: str
    finished_at: Optional[str] = None
    status: str
    exit_code: Optional[int] = None
    output: Optional[str] = None
    triggered_by: str
    action: Optional[str] = None


class ScheduledJobChildResponse(BaseModel):
    """Eingebetteter Child-Job für Zeitfenster-Modus."""
    id: str
    cron_expression: str
    config: dict[str, Any]
    last_run_at: Optional[str] = None
    last_run_status: Optional[str] = None
    next_run_at: Optional[str] = None


class ScheduledJobResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    job_type: str
    cron_expression: str
    active: bool
    config: dict[str, Any]
    created_by: str
    created_at: str
    updated_at: str
    last_run_at: Optional[str] = None
    last_run_status: Optional[str] = None
    next_run_at: Optional[str] = None
    child_job: Optional[ScheduledJobChildResponse] = None


# ── Settings-Schemas ──────────────────────────────────────────────────────────

class ScheduledJobsSettingsResponse(BaseModel):
    history_limit: int
    has_system_ssh_key: bool


class SystemSshKeyRequest(BaseModel):
    key: str

    @field_validator("key")
    @classmethod
    def key_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("SSH-Key darf nicht leer sein")
        return v


class HistoryLimitRequest(BaseModel):
    limit: int

    @field_validator("limit")
    @classmethod
    def valid_limit(cls, v: int) -> int:
        if v < 1 or v > 500:
            raise ValueError("History-Limit muss zwischen 1 und 500 liegen")
        return v
