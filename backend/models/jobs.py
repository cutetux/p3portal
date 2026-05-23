# p3portal.org
from __future__ import annotations

from pydantic import AnyHttpUrl, BaseModel


class JobCreate(BaseModel):
    playbook: str
    params: dict = {}
    auto_assign_owner: bool = True       # PROJ-48: Checkbox „Mich als Owner eintragen"
    callback_url: AnyHttpUrl | None = None  # PROJ-44: optionaler Webhook nach Job-Abschluss
    pool_id: int | None = None           # PROJ-62: optionaler Pool-Kontext für Auto-Member-Add + Quota-Check


class JobResponse(BaseModel):
    id: str
    type: str
    playbook: str
    status: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    username: str
    params: dict
