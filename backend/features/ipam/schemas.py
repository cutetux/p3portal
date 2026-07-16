# p3portal.org
"""PROJ-42 Phase 1 – Pydantic-Schemas für den Core Simple-IPAM.

IPv4-only (MVP). Alle Netz-/IP-Felder werden mit der `ipaddress`-Stdlib validiert;
keine externe Dependency. Netz-Identität = (kind, network_name, node, vlan_tag);
NULL-Semantik wird nach außen als None geführt und intern auf Sentinels ('' / 0)
normalisiert (siehe service._to_row / _from_row).
"""
from __future__ import annotations

import ipaddress
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


def _validate_ipv4(value: str, field: str) -> str:
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        raise ValueError(f"{field}: '{value}' ist keine gültige IP-Adresse")
    if addr.version != 4:
        raise ValueError(f"{field}: nur IPv4 wird unterstützt (MVP)")
    return str(addr)


def _validate_cidr(value: str) -> str:
    try:
        net = ipaddress.ip_network(value, strict=False)
    except ValueError:
        raise ValueError(f"cidr: '{value}' ist kein gültiges Netz (z. B. 192.168.2.0/24)")
    if net.version != 4:
        raise ValueError("cidr: nur IPv4 wird unterstützt (MVP)")
    return str(net)


class IpPoolBase(BaseModel):
    kind: Literal["bridge", "vnet"]
    network_name: str = Field(min_length=1, max_length=100)
    node: Optional[str] = Field(default=None, max_length=100)  # None = cluster-weit (vnet)
    vlan_tag: Optional[int] = Field(default=None, ge=1, le=4094)  # None = untagged
    cidr: str
    gateway: Optional[str] = None
    dns: Optional[list[str]] = None
    range_start: Optional[str] = None
    range_end: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("cidr")
    @classmethod
    def _v_cidr(cls, v: str) -> str:
        return _validate_cidr(v)

    @field_validator("gateway", "range_start", "range_end")
    @classmethod
    def _v_ipv4(cls, v: Optional[str], info) -> Optional[str]:
        if v is None or v == "":
            return None
        return _validate_ipv4(v, info.field_name)

    @model_validator(mode="after")
    def _v_consistency(self) -> "IpPoolBase":
        net = ipaddress.ip_network(self.cidr, strict=False)
        # bridge braucht einen Node; vnet ist cluster-weit (kein Node)
        if self.kind == "bridge" and not self.node:
            raise ValueError("node ist für kind='bridge' erforderlich")
        if self.kind == "vnet":
            self.node = None
        for label in ("gateway", "range_start", "range_end"):
            val = getattr(self, label)
            if val and ipaddress.ip_address(val) not in net:
                raise ValueError(f"{label} '{val}' liegt nicht im cidr {self.cidr}")
        if self.range_start and self.range_end:
            if ipaddress.ip_address(self.range_start) > ipaddress.ip_address(self.range_end):
                raise ValueError("range_start darf nicht größer als range_end sein")
        return self


class IpPoolCreateRequest(IpPoolBase):
    pass


class IpPoolUpdateRequest(IpPoolBase):
    """Vollständige Neu-Definition eines Pools (PUT-Semantik)."""
    pass


class IpPoolResponse(IpPoolBase):
    id: int
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SuggestResponse(BaseModel):
    """best-effort Free-IP-Vorschlag (zustandslos, live aus Proxmox)."""
    pool_id: int
    ip: Optional[str] = None            # None = kein Vorschlag möglich
    best_effort: bool = True            # Core ist immer best-effort
    reason: Optional[str] = None        # z. B. "pool_exhausted"
