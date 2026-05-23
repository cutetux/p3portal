# p3portal.org
from __future__ import annotations

from pydantic import AnyHttpUrl, BaseModel


class PackerParameter(BaseModel):
    id: str
    label: str
    type: str  # string | integer | dropdown | bool | ssh_key
    required: bool = False
    default: str | int | bool | None = None
    min: int | None = None
    max: int | None = None
    options: list[dict] | None = None


class PackerMeta(BaseModel):
    name: str
    description: str
    required_role: str | None = None
    parameters: list[PackerParameter] = []
    approval: dict | None = None  # PROJ-50: optionaler approval:-Block


class PackerSummary(BaseModel):
    id: str
    name: str
    description: str
    required_role: str | None = None


class PackerDetail(PackerSummary):
    parameters: list[PackerParameter]


class PackerBuildRequest(BaseModel):
    params: dict = {}
    callback_url: AnyHttpUrl | None = None  # PROJ-44: optionaler Webhook nach Build-Abschluss


class ProxmoxTemplateInfo(BaseModel):
    vmid: int
    name: str
    node: str
    type: str  # "qemu" or "lxc"
    ctime: int | None = None
