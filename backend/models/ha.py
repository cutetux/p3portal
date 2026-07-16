# p3portal.org
"""PROJ-103: Schemas für die Proxmox-HA-Verwaltung (Regeln / Ressourcen / Status).

Proxmox ist Single Source of Truth — es gibt **keine DB-Tabelle**. Diese Modelle
beschreiben nur die Request-/Response-Form und kapseln das Mapping auf die
Proxmox-Parameter (`to_proxmox_params`) sowie die serverseitige Validierung
(422 vor Proxmox). HA ist cluster-weit innerhalb EINER Proxmox-Installation
(Datacenter-Ebene, `/cluster/ha/*`), analog zu SDN (PROJ-80).

**PVE-9-Pivot (S748):** Proxmox VE 9 hat die HA-**Gruppen** abgeschafft und durch
HA-**Regeln** (`/cluster/ha/rules`) ersetzt. Zwei Regeltypen:
  * ``node-affinity``     – ersetzt die alten Gruppen: welche Nodes (mit Priorität)
    eine/mehrere Ressourcen bevorzugen/dürfen (``strict`` = altes ``restricted``).
  * ``resource-affinity`` – hält Ressourcen zusammen (``positive``) oder getrennt
    (``negative``).
Das ``group``-Feld einer Ressource entfällt; ``nofailback`` wandert als
``failback`` (invertiert) an die Ressource.

SID-Konvention: eine HA-Ressource ist `vm:<id>` (QEMU) oder `ct:<id>` (LXC).
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator, model_validator

# HA-Ressourcen-SID: vm:<id> oder ct:<id>.
_HA_SID_RE = re.compile(r"^(vm|ct):\d+$")
# HA-Regel-ID (PVE config-id): startet mit Buchstabe, alphanumerisch + - _ .
_HA_RULE_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9\-_.]{0,62}$")

# Erlaubte Soll-Zustände einer HA-Ressource (PVE 9 ergänzt "enabled").
_HA_STATES = ("started", "stopped", "disabled", "ignored", "enabled")
# Regeltypen und Affinity-Werte (PVE 9).
_HA_RULE_TYPES = ("node-affinity", "resource-affinity")
_HA_AFFINITY = ("positive", "negative")


# ── Read models ──────────────────────────────────────────────────────────────

class HaRuleNode(BaseModel):
    """Eine Node innerhalb einer node-affinity-Regel, optional mit Priorität."""
    node: str
    priority: int | None = None


class HaRule(BaseModel):
    """Eine HA-Regel wie sie ans Frontend geht (node-affinity | resource-affinity)."""
    id: str                                   # rule name
    type: str | None = None                   # "node-affinity" | "resource-affinity"
    resources: list[str] = []                 # betroffene SIDs
    resources_raw: str | None = None          # roher PVE-Wert "vm:100,ct:101"
    nodes: list[HaRuleNode] = []              # node-affinity: geparste Node-Liste
    nodes_raw: str | None = None              # node-affinity: roher PVE-Wert
    strict: bool = False                      # node-affinity: = altes "restricted"
    affinity: str | None = None               # resource-affinity: "positive"|"negative"
    comment: str | None = None
    disable: bool = False
    digest: str | None = None


class HaResource(BaseModel):
    """Eine HA-Ressource (VM/CT) wie sie ans Frontend geht."""
    sid: str                                  # "vm:100" | "ct:100"
    type: str | None = None                   # "vm" | "ct"
    state: str | None = None                  # Soll-Zustand (started/stopped/disabled/ignored/enabled)
    max_restart: int | None = None
    max_relocate: int | None = None
    failback: bool | None = None              # PVE 9: automatischer Rückzug auf höchste Prio
    comment: str | None = None
    digest: str | None = None


class HaServiceStatus(BaseModel):
    """Live-Zustand einer HA-Ressource aus `ha-manager status`."""
    sid: str
    state: str | None = None                  # aktueller Zustand (started/stopped/error/migrate/…)
    node: str | None = None                   # aktuelle Node
    crm_state: str | None = None
    request_state: str | None = None          # Soll-Zustand


class HaNodeStatus(BaseModel):
    """CRM-/LRM-Status einer Node aus `ha-manager status`."""
    node: str
    type: str                                 # "lrm" | "crm" | "master"
    status: str | None = None


class _HaAvailabilityBase(BaseModel):
    """Gemeinsame Flags: HA-/Cluster-Verfügbarkeit statt harter Fehler (EC-Gating)."""
    ha_unavailable: bool = False              # HA nicht verfügbar (Standalone / kein Quorum-Stack)
    permission_denied: bool = False           # Token-Rechte fehlen (403 vom Proxmox)
    cluster_unreachable: bool = False
    detail: str | None = None


class HaStatusResponse(_HaAvailabilityBase):
    """Aggregierter HA-Status (Quorum + Manager + Ressourcen-Zustände)."""
    quorate: bool | None = None
    manager_node: str | None = None
    manager_status: str | None = None
    nodes: list[HaNodeStatus] = []
    resources: list[HaServiceStatus] = []


class HaRuleListResponse(_HaAvailabilityBase):
    items: list[HaRule] = []


class HaResourceListResponse(_HaAvailabilityBase):
    items: list[HaResource] = []


class HaWriteResponse(BaseModel):
    id: str
    warnings: list[str] = []


# ── Write requests ───────────────────────────────────────────────────────────

class HaRuleNodeInput(BaseModel):
    node: str
    priority: int | None = Field(default=None, ge=0, le=1000)

    @field_validator("node")
    @classmethod
    def _valid_node(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("node must not be empty")
        return v.strip()


class HaRuleWriteRequest(BaseModel):
    """HA-Regel anlegen oder vollständig bearbeiten.

    Gleicher Body für POST (create) und PUT (update); der Router liefert die
    Regel-ID auf Update aus dem Pfad (``to_proxmox_params(for_update=True)`` lässt
    ``rule``/``type`` weg — der Typ ist unveränderlich).

    Typ-diskriminierte Validierung:
      * ``node-affinity``     ⇒ mind. 1 Node + mind. 1 Ressource.
      * ``resource-affinity`` ⇒ ``affinity`` gesetzt + mind. 2 Ressourcen.
    """
    rule: str
    type: str
    resources: list[str]
    nodes: list[HaRuleNodeInput] = []
    strict: bool = False
    affinity: str | None = None
    comment: str | None = None
    disable: bool = False

    @field_validator("rule")
    @classmethod
    def _valid_rule(cls, v: str) -> str:
        if not _HA_RULE_ID_RE.match(v):
            raise ValueError(
                f"Invalid HA rule id {v!r}: must start with a letter and contain "
                "only letters, digits, '-', '_' or '.'"
            )
        return v

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in _HA_RULE_TYPES:
            raise ValueError(f"type must be one of {_HA_RULE_TYPES}")
        return v

    @field_validator("resources")
    @classmethod
    def _valid_resources(cls, v: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for sid in v:
            sid = (sid or "").strip()
            if not _HA_SID_RE.match(sid):
                raise ValueError(f"Invalid HA resource sid {sid!r}: expected 'vm:<id>' or 'ct:<id>'")
            if sid in seen:
                raise ValueError(f"duplicate resource in rule: {sid}")
            seen.add(sid)
            out.append(sid)
        return out

    @model_validator(mode="after")
    def _check_type_fields(self) -> "HaRuleWriteRequest":
        if self.type == "node-affinity":
            if not self.nodes:
                raise ValueError("a node-affinity rule needs at least one node")
            seen: set[str] = set()
            for n in self.nodes:
                if n.node in seen:
                    raise ValueError(f"duplicate node in rule: {n.node}")
                seen.add(n.node)
            if not self.resources:
                raise ValueError("a node-affinity rule needs at least one resource")
        elif self.type == "resource-affinity":
            if self.affinity not in _HA_AFFINITY:
                raise ValueError(f"affinity must be one of {_HA_AFFINITY}")
            if len(self.resources) < 2:
                raise ValueError("a resource-affinity rule needs at least two resources")
        return self

    def _nodes_param(self) -> str:
        """Serialisiere die Node-Liste zu 'node:prio,node,…' (PVE-Format)."""
        parts: list[str] = []
        for n in self.nodes:
            parts.append(f"{n.node}:{n.priority}" if n.priority is not None else n.node)
        return ",".join(parts)

    def _resources_param(self) -> str:
        return ",".join(self.resources)

    def to_proxmox_params(self, for_update: bool = False) -> dict:
        """Map auf den Proxmox /cluster/ha/rules Parameter-Dict.

        Auf Create ergänzt der Router ``rule`` (id) + ``type``. ``type`` ist
        unveränderlich, wird also nur beim Anlegen gesendet.
        """
        params: dict = {"resources": self._resources_param()}
        if self.type == "node-affinity":
            params["nodes"] = self._nodes_param()
            params["strict"] = 1 if self.strict else 0
        elif self.type == "resource-affinity":
            params["affinity"] = self.affinity
        params["disable"] = 1 if self.disable else 0
        if self.comment:
            params["comment"] = self.comment
        return params


class HaResourceWriteRequest(BaseModel):
    """HA-Ressource hinzufügen oder bearbeiten.

    Auf Create liefert der Router ``sid`` explizit; auf Update steht die SID im
    Pfad. Der Soll-Zustand ``state`` ist Pflicht (Default ``started``). Das alte
    ``group``-Feld entfällt (PVE 9 → node-affinity-Regeln).
    """
    sid: str
    state: str = "started"
    max_restart: int | None = Field(default=None, ge=0, le=100)
    max_relocate: int | None = Field(default=None, ge=0, le=100)
    failback: bool | None = None
    comment: str | None = None

    @field_validator("sid")
    @classmethod
    def _valid_sid(cls, v: str) -> str:
        if not _HA_SID_RE.match(v):
            raise ValueError(f"Invalid HA sid {v!r}: expected 'vm:<id>' or 'ct:<id>'")
        return v

    @field_validator("state")
    @classmethod
    def _valid_state(cls, v: str) -> str:
        if v not in _HA_STATES:
            raise ValueError(f"state must be one of {_HA_STATES}")
        return v

    def to_proxmox_params(self, for_update: bool = False) -> dict:
        """Map auf den Proxmox /cluster/ha/resources Parameter-Dict.

        Auf Create ergänzt der Router ``sid`` explizit. ``state`` wird immer
        gesendet; optionale Felder nur wenn gesetzt.
        """
        params: dict = {"state": self.state}
        if self.max_restart is not None:
            params["max_restart"] = self.max_restart
        if self.max_relocate is not None:
            params["max_relocate"] = self.max_relocate
        if self.failback is not None:
            params["failback"] = 1 if self.failback else 0
        if self.comment:
            params["comment"] = self.comment
        return params


class HaRuntimeActionRequest(BaseModel):
    """Ziel-Node für eine Laufzeit-Aktion (migrate/relocate)."""
    node: str

    @field_validator("node")
    @classmethod
    def _valid_node(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("target node must not be empty")
        return v.strip()
