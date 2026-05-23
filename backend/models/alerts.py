# p3portal.org
"""PROJ-34: Pydantic v2 schemas for VM/LXC Monitoring & Alerting."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator


# ── Enums / literals ──────────────────────────────────────────────────────────

AlertMetric = Literal["cpu_percent", "mem_percent", "disk_percent", "status"]
AlertScope  = Literal["global", "preset", "vm"]
AlertSeverity = Literal["warning", "critical"]
AlertState = Literal["ok", "pending", "warning", "pending_critical", "critical"]
AlertEventState = Literal["firing", "resolved"]


# ── Alert Rule schemas ────────────────────────────────────────────────────────

class AlertRuleBase(BaseModel):
    name: str
    metric: AlertMetric
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    sustained_polls: int = 1
    enabled: bool = True
    notify_recovery: bool = True
    filesystem: Optional[str] = None
    webhook_url: Optional[str] = None
    webhook_token: Optional[str] = None
    webhook_receiver_type: Optional[str] = "custom"  # 'custom' | 'gotify'
    webhook_verify_ssl: bool = True  # PROJ-67 BUG-67-1: Per-Receiver TLS-Verify Override
    email_recipients: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("sustained_polls")
    @classmethod
    def sustained_polls_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("sustained_polls must be >= 1")
        return v

    @model_validator(mode="after")
    def validate_thresholds(self) -> "AlertRuleBase":
        w = self.warning_threshold
        c = self.critical_threshold

        if w is None and c is None:
            raise ValueError("At least one of warning_threshold or critical_threshold must be set")

        if w is not None and c is not None and w >= c:
            raise ValueError("warning_threshold must be less than critical_threshold")

        if self.metric == "status":
            # For status metric only critical makes sense (target status e.g. stopped)
            if w is not None:
                raise ValueError("warning_threshold is not supported for metric 'status'")

        return self


class GlobalRuleCreateRequest(AlertRuleBase):
    pass


class GlobalRuleUpdateRequest(BaseModel):
    name: Optional[str] = None
    metric: Optional[AlertMetric] = None
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    sustained_polls: Optional[int] = None
    enabled: Optional[bool] = None
    notify_recovery: Optional[bool] = None
    filesystem: Optional[str] = None
    webhook_url: Optional[str] = None
    webhook_token: Optional[str] = None
    webhook_receiver_type: Optional[str] = None
    webhook_verify_ssl: Optional[bool] = None  # PROJ-67 BUG-67-1
    email_recipients: Optional[str] = None


class VmRuleCreateRequest(AlertRuleBase):
    pass


class VmRuleUpdateRequest(GlobalRuleUpdateRequest):
    pass


class AlertRuleResponse(BaseModel):
    id: int
    scope: AlertScope
    preset_id: Optional[int] = None
    vmid: Optional[str] = None
    node_id: Optional[int] = None
    name: str
    metric: AlertMetric
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    sustained_polls: int
    enabled: bool
    notify_recovery: bool
    filesystem: Optional[str] = None
    webhook_url: Optional[str] = None
    webhook_receiver_type: Optional[str] = "custom"
    webhook_verify_ssl: bool = True  # PROJ-67 BUG-67-1
    email_recipients: Optional[str] = None
    created_by: str
    created_at: str
    updated_at: str


# ── Alert Preset schemas ──────────────────────────────────────────────────────

class AlertPresetCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    rules: list[AlertRuleBase] = []

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()


class AlertPresetUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rules: Optional[list[AlertRuleBase]] = None


class AlertPresetResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    rule_count: int = 0
    vm_count: int = 0
    created_by: str
    created_at: str
    rules: list[AlertRuleResponse] = []


# ── Preset Assignment schemas ─────────────────────────────────────────────────

class PresetAssignRequest(BaseModel):
    vmid: str
    node_id: int

    @field_validator("vmid")
    @classmethod
    def vmid_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("vmid must not be empty")
        return v.strip()


class PresetAssignmentResponse(BaseModel):
    id: int
    preset_id: int
    preset_name: str
    vmid: str
    node_id: int
    assigned_at: str


# ── Threshold Override schemas ────────────────────────────────────────────────

class ThresholdOverrideItem(BaseModel):
    rule_id: int
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None

    @model_validator(mode="after")
    def at_least_one(self) -> "ThresholdOverrideItem":
        if self.warning_threshold is None and self.critical_threshold is None:
            raise ValueError("At least one threshold must be provided for an override")
        return self


class ThresholdOverridesUpdateRequest(BaseModel):
    overrides: list[ThresholdOverrideItem]


class ThresholdOverrideResponse(BaseModel):
    id: int
    rule_id: int
    vmid: str
    node_id: int
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None


# ── VM Alert summary ──────────────────────────────────────────────────────────

class EffectiveRule(BaseModel):
    """A rule as it applies to a specific VM (after merge of global/preset/vm layers)."""
    rule_id: int
    name: str
    metric: AlertMetric
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    sustained_polls: int
    enabled: bool
    notify_recovery: bool
    filesystem: Optional[str] = None
    source: Literal["global", "preset", "vm"]
    override_applied: bool = False


class VmAlertSummaryResponse(BaseModel):
    vmid: str
    node_id: int
    preset: Optional[AlertPresetResponse] = None
    vm_rules: list[AlertRuleResponse] = []
    effective_rules: list[EffectiveRule] = []
    overrides: list[ThresholdOverrideResponse] = []


# ── Alert State schemas ───────────────────────────────────────────────────────

class AlertStateResponse(BaseModel):
    id: int
    rule_id: int
    rule_name: str
    metric: AlertMetric
    vmid: str
    node_id: int
    severity: AlertSeverity
    state: AlertState
    pending_count: int
    last_value: Optional[float] = None
    last_checked_at: Optional[str] = None
    last_changed_at: Optional[str] = None
    last_event_id: Optional[int] = None


# ── Alert Event schemas ───────────────────────────────────────────────────────

class AlertEventResponse(BaseModel):
    id: int
    rule_id: Optional[int] = None
    rule_name: str
    vmid: str
    node_id: Optional[int] = None
    vm_name: Optional[str] = None
    metric: AlertMetric
    value: Optional[float] = None
    threshold: Optional[float] = None
    severity: AlertSeverity
    state: AlertEventState
    timestamp: str
    acknowledged_by: list[str] = []


# ── Acknowledge schema ────────────────────────────────────────────────────────

class AcknowledgeResponse(BaseModel):
    alert_event_id: int
    username: str
    acknowledged_at: str


# ── SMTP Config schemas ───────────────────────────────────────────────────────

class SmtpConfigResponse(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    use_tls: bool = True
    from_address: Optional[str] = None
    configured: bool = False


class TestWebhookRequest(BaseModel):
    webhook_url: str
    webhook_token: Optional[str] = None
    webhook_receiver_type: str = "custom"  # 'custom' | 'gotify'
    webhook_verify_ssl: bool = True  # PROJ-67 BUG-67-1: Per-Receiver TLS-Verify Override
    rule_id: Optional[int] = None  # wenn gesetzt: Token aus DB lesen falls leer

    @field_validator("webhook_url")
    @classmethod
    def url_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("webhook_url must not be empty")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("webhook_url must start with http:// or https://")
        return v


class TestWebhookResponse(BaseModel):
    ok: bool
    status_code: Optional[int] = None
    body_preview: str = ""
    error: Optional[str] = None
    adapter: Optional[str] = None  # 'gotify' | 'native'


class SmtpConfigUpdateRequest(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    use_tls: bool = True
    from_address: Optional[str] = None

    @field_validator("port")
    @classmethod
    def valid_port(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 65535):
            raise ValueError("port must be between 1 and 65535")
        return v
