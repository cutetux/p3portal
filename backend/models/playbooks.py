# p3portal.org
from __future__ import annotations

from pydantic import BaseModel


class PlaybookParameter(BaseModel):
    id: str
    label: str
    type: str  # string | integer | dropdown | bool | ssh_key | password | target_host | proxmox_node | proxmox_template | ip_config | vm_access
    required: bool = False
    default: str | int | bool | None = None
    min: int | None = None
    max: int | None = None
    options: list[dict] | None = None


class PlaybookPreset(BaseModel):
    label: str
    values: dict[str, str | int | bool | float]


class PlaybookMeta(BaseModel):
    name: str
    description: str
    playbook: str
    required_role: str | None = None
    category: str | None = None  # vm_deployment | lxc_deployment | vm_lxc_config
    parameters: list[PlaybookParameter] = []
    presets: list[PlaybookPreset] = []
    approval: dict | None = None  # PROJ-50: optionaler approval:-Block für Approval-Workflow


class PlaybookSummary(BaseModel):
    id: str
    name: str
    description: str
    required_role: str | None = None
    category: str | None = None
    can_execute: bool | None = None  # PROJ-49: gesetzt wenn user_id bekannt


class PlaybookDetail(PlaybookSummary):
    parameters: list[PlaybookParameter]
    presets: list[PlaybookPreset] = []
