# p3portal.org
"""PROJ-34: REST-Endpunkte für VM/LXC Monitoring & Alerting."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.core.plus_protocol import plus_behavior
from backend.services.local_auth import get_user_by_username
from backend.services.rbac_service import get_user_permissions, has_any_assignments
from backend.models.alerts import (
    AcknowledgeResponse,
    AlertEventResponse,
    AlertPresetCreateRequest,
    AlertPresetResponse,
    AlertPresetUpdateRequest,
    AlertRuleResponse,
    AlertStateResponse,
    GlobalRuleCreateRequest,
    GlobalRuleUpdateRequest,
    PresetAssignRequest,
    PresetAssignmentResponse,
    SmtpConfigResponse,
    SmtpConfigUpdateRequest,
    TestWebhookRequest,
    TestWebhookResponse,
    ThresholdOverrideResponse,
    ThresholdOverridesUpdateRequest,
    VmAlertSummaryResponse,
    VmRuleCreateRequest,
    VmRuleUpdateRequest,
)
from backend.services import alert_rule_service as svc

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _require_plus() -> None:
    if not plus_behavior.can_use_alert_presets():
        raise HTTPException(status_code=403, detail="Plus-Lizenz erforderlich")


# ── Test Webhook (authenticated user) ─────────────────────────────────────────

@router.post("/test-webhook", response_model=TestWebhookResponse)
async def test_webhook(
    body: TestWebhookRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> TestWebhookResponse:
    """Send a test notification to the supplied webhook URL.

    The caller passes the URL and optional Bearer token currently shown in the
    form (not necessarily the saved value). Used by the "Test"-buttons in the
    profile-notifications tab, alert-rule modal and alert-preset modal.
    """
    from backend.services.alert_notification_service import _build_effective_url, send_test_webhook
    receiver_type = body.webhook_receiver_type or "custom"
    resolved_token = body.webhook_token or None

    # Wenn kein Token im Formular (wegen Security nie zurückgegeben) aber rule_id bekannt:
    # Token aus DB lesen, damit _build_effective_url die URL korrekt aufbauen kann.
    if not resolved_token and body.rule_id:
        try:
            from backend.services.alert_rule_service import _get_raw_webhook_token
            from backend.services.config_service import decrypt_secret
            raw = await _get_raw_webhook_token(body.rule_id)
            if raw:
                resolved_token = decrypt_secret(raw)
        except Exception:
            pass

    effective_url = _build_effective_url(body.webhook_url, resolved_token, receiver_type)
    result = await send_test_webhook(
        webhook_url=effective_url,
        webhook_token=resolved_token,
        username=current_user.username,
        source_label="manual-test",
        receiver_type=receiver_type,
        verify_ssl=body.webhook_verify_ssl,
    )
    return TestWebhookResponse(**result)


# ── Global Rules (Admin, Basis+Plus) ─────────────────────────────────────────

@router.get("/rules", response_model=list[AlertRuleResponse])
async def list_global_rules(
    _: CurrentUser = Depends(require_admin),
) -> list[AlertRuleResponse]:
    rules = await svc.list_global_rules()
    return [AlertRuleResponse(**r) for r in rules]


@router.post("/rules", response_model=AlertRuleResponse, status_code=201)
async def create_global_rule(
    body: GlobalRuleCreateRequest,
    current_user: CurrentUser = Depends(require_admin),
) -> AlertRuleResponse:
    notif = plus_behavior.filter_alert_notification_fields(
        {
            "webhook_url": body.webhook_url,
            "webhook_token": body.webhook_token,
            "email_recipients": body.email_recipients,
        }
    )
    rule = await svc.create_rule(
        scope="global",
        name=body.name,
        metric=body.metric,
        warning_threshold=body.warning_threshold,
        critical_threshold=body.critical_threshold,
        sustained_polls=body.sustained_polls,
        enabled=body.enabled,
        notify_recovery=body.notify_recovery,
        filesystem=body.filesystem,
        webhook_url=notif["webhook_url"],
        webhook_token=notif["webhook_token"],
        webhook_receiver_type=body.webhook_receiver_type or "custom",
        webhook_verify_ssl=body.webhook_verify_ssl,
        email_recipients=notif["email_recipients"],
        created_by=current_user.username,
    )
    return AlertRuleResponse(**rule)


@router.put("/rules/{rule_id}", response_model=AlertRuleResponse)
async def update_global_rule(
    rule_id: int,
    body: GlobalRuleUpdateRequest,
    _: CurrentUser = Depends(require_admin),
) -> AlertRuleResponse:
    existing = await svc.get_rule_by_id(rule_id)
    if not existing or existing["scope"] != "global":
        raise HTTPException(status_code=404, detail="Regel nicht gefunden")
    updates = body.model_dump(exclude_unset=True)
    rule = await svc.update_rule(rule_id, updates)
    return AlertRuleResponse(**rule)  # type: ignore[arg-type]


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_global_rule(
    rule_id: int,
    _: CurrentUser = Depends(require_admin),
) -> Response:
    existing = await svc.get_rule_by_id(rule_id)
    if not existing or existing["scope"] != "global":
        raise HTTPException(status_code=404, detail="Regel nicht gefunden")
    await svc.delete_rule(rule_id)
    return Response(status_code=204)


# ── Presets (Admin, Plus-only) ────────────────────────────────────────────────

@router.get("/presets", response_model=list[AlertPresetResponse])
async def list_presets(
    _: CurrentUser = Depends(require_admin),
) -> list[AlertPresetResponse]:
    _require_plus()
    presets = await svc.list_presets()
    result = []
    for p in presets:
        p["rules"] = await svc.list_preset_rules(p["id"])
        result.append(AlertPresetResponse(**p))
    return result


@router.post("/presets", response_model=AlertPresetResponse, status_code=201)
async def create_preset(
    body: AlertPresetCreateRequest,
    current_user: CurrentUser = Depends(require_admin),
) -> AlertPresetResponse:
    _require_plus()
    rules_data = [r.model_dump() for r in body.rules]
    preset = await svc.create_preset(
        name=body.name,
        description=body.description,
        created_by=current_user.username,
        rules=rules_data,
    )
    return AlertPresetResponse(**preset)


@router.put("/presets/{preset_id}", response_model=AlertPresetResponse)
async def update_preset(
    preset_id: int,
    body: AlertPresetUpdateRequest,
    current_user: CurrentUser = Depends(require_admin),
) -> AlertPresetResponse:
    _require_plus()
    existing = await svc.get_preset_by_id(preset_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden")
    rules_data = [r.model_dump() for r in body.rules] if body.rules is not None else None
    preset = await svc.update_preset(
        preset_id=preset_id,
        name=body.name,
        description=body.description,
        rules=rules_data,
        updated_by=current_user.username,
    )
    return AlertPresetResponse(**preset)  # type: ignore[arg-type]


@router.delete("/presets/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: int,
    _: CurrentUser = Depends(require_admin),
) -> Response:
    _require_plus()
    found = await svc.delete_preset(preset_id)
    if not found:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden")
    return Response(status_code=204)


# ── Preset Assignments (Admin, Plus-only) ─────────────────────────────────────

@router.post("/presets/{preset_id}/assign", response_model=PresetAssignmentResponse, status_code=201)
async def assign_preset(
    preset_id: int,
    body: PresetAssignRequest,
    _: CurrentUser = Depends(require_admin),
) -> PresetAssignmentResponse:
    _require_plus()
    preset = await svc.get_preset_by_id(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden")
    assignment = await svc.assign_preset(preset_id, body.vmid, body.node_id)
    return PresetAssignmentResponse(**assignment)  # type: ignore[arg-type]


@router.delete("/presets/{preset_id}/assign/{vmid}", status_code=204)
async def remove_assignment(
    preset_id: int,
    vmid: str,
    node_id: int = Query(...),
    _: CurrentUser = Depends(require_admin),
) -> Response:
    _require_plus()
    found = await svc.remove_assignment(preset_id, vmid, node_id)
    if not found:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    return Response(status_code=204)


# ── VM-specific Rules & Summary ───────────────────────────────────────────────

@router.get("/vm/{node_id}/{vmid}", response_model=VmAlertSummaryResponse)
async def get_vm_alert_summary(
    node_id: int,
    vmid: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> VmAlertSummaryResponse:
    plus = plus_behavior.can_use_alert_presets()
    preset = await svc.get_vm_preset(vmid, node_id) if plus else None
    vm_rules = await svc.list_vm_rules(node_id, vmid)
    effective = await svc.get_effective_rules(vmid, node_id, plus)
    overrides = await svc.list_overrides(vmid, node_id) if plus else []

    preset_resp = AlertPresetResponse(**preset) if preset else None

    from backend.models.alerts import EffectiveRule
    eff_resp = [EffectiveRule(**e) for e in effective]

    return VmAlertSummaryResponse(
        vmid=vmid,
        node_id=node_id,
        preset=preset_resp,
        vm_rules=[AlertRuleResponse(**r) for r in vm_rules],
        effective_rules=eff_resp,
        overrides=[ThresholdOverrideResponse(**o) for o in overrides],
    )


@router.post("/vm/{node_id}/{vmid}/rules", response_model=AlertRuleResponse, status_code=201)
async def create_vm_rule(
    node_id: int,
    vmid: str,
    body: VmRuleCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AlertRuleResponse:
    notif = plus_behavior.filter_alert_notification_fields(
        {
            "webhook_url": body.webhook_url,
            "webhook_token": body.webhook_token,
            "email_recipients": body.email_recipients,
        }
    )
    rule = await svc.create_rule(
        scope="vm",
        name=body.name,
        metric=body.metric,
        warning_threshold=body.warning_threshold,
        critical_threshold=body.critical_threshold,
        sustained_polls=body.sustained_polls,
        enabled=body.enabled,
        notify_recovery=body.notify_recovery,
        filesystem=body.filesystem,
        webhook_url=notif["webhook_url"],
        webhook_token=notif["webhook_token"],
        webhook_receiver_type=body.webhook_receiver_type or "custom",
        webhook_verify_ssl=body.webhook_verify_ssl,
        email_recipients=notif["email_recipients"],
        node_id=node_id,
        vmid=vmid,
        created_by=current_user.username,
    )
    return AlertRuleResponse(**rule)


@router.put("/vm/{node_id}/{vmid}/rules/{rule_id}", response_model=AlertRuleResponse)
async def update_vm_rule(
    node_id: int,
    vmid: str,
    rule_id: int,
    body: VmRuleUpdateRequest,
    _: CurrentUser = Depends(get_current_user),
) -> AlertRuleResponse:
    existing = await svc.get_rule_by_id(rule_id)
    if not existing or existing["scope"] != "vm":
        raise HTTPException(status_code=404, detail="Regel nicht gefunden")
    if str(existing.get("vmid")) != str(vmid) or existing.get("node_id") != node_id:
        raise HTTPException(status_code=403, detail="Zugriff verweigert")
    updates = body.model_dump(exclude_unset=True)
    rule = await svc.update_rule(rule_id, updates)
    return AlertRuleResponse(**rule)  # type: ignore[arg-type]


@router.delete("/vm/{node_id}/{vmid}/rules/{rule_id}", status_code=204)
async def delete_vm_rule(
    node_id: int,
    vmid: str,
    rule_id: int,
    _: CurrentUser = Depends(get_current_user),
) -> Response:
    existing = await svc.get_rule_by_id(rule_id)
    if not existing or existing["scope"] != "vm":
        raise HTTPException(status_code=404, detail="Regel nicht gefunden")
    if str(existing.get("vmid")) != str(vmid) or existing.get("node_id") != node_id:
        raise HTTPException(status_code=403, detail="Zugriff verweigert")
    await svc.delete_rule(rule_id)
    return Response(status_code=204)


# ── Threshold Overrides (Plus) ────────────────────────────────────────────────

@router.put("/vm/{node_id}/{vmid}/overrides", response_model=list[ThresholdOverrideResponse])
async def update_threshold_overrides(
    node_id: int,
    vmid: str,
    body: ThresholdOverridesUpdateRequest,
    _: CurrentUser = Depends(get_current_user),
) -> list[ThresholdOverrideResponse]:
    _require_plus()
    overrides_data = [o.model_dump() for o in body.overrides]
    overrides = await svc.upsert_overrides(vmid, node_id, overrides_data)
    return [ThresholdOverrideResponse(**o) for o in overrides]


# ── Alert States (all authenticated users) ────────────────────────────────────

@router.get("/states", response_model=list[AlertStateResponse])
async def list_alert_states(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[AlertStateResponse]:
    is_admin = current_user.role == "admin"
    states = await svc.list_alert_states(
        username=current_user.username,
        is_admin=is_admin,
        active_only=True,
    )
    return [AlertStateResponse(**s) for s in states]


# ── Alert Events / History ────────────────────────────────────────────────────

@router.get("/events", response_model=list[AlertEventResponse])
async def list_alert_events(
    vmid: Optional[str] = Query(None),
    rule_id: Optional[int] = Query(None),
    metric: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[AlertEventResponse]:
    # Determine which VMIDs the user may see (None = no restriction)
    allowed_vmids: set[str] | None = None
    if current_user.auth_type != "proxmox" and current_user.role not in ("admin", "operator"):
        user = await get_user_by_username(current_user.username)
        if user and await has_any_assignments(user["id"]):
            perms = await get_user_permissions(user["id"])
            allowed_vmids = {str(p["resource_id"]) for p in perms}

    events = await svc.list_alert_events(
        vmid=vmid,
        rule_id=rule_id,
        metric=metric,
        state=state,
        since=since,
        until=until,
        limit=limit,
        allowed_vmids=allowed_vmids,
    )
    return [AlertEventResponse(**e) for e in events]


@router.post("/events/{event_id}/acknowledge", response_model=AcknowledgeResponse)
async def acknowledge_alert(
    event_id: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> AcknowledgeResponse:
    result = await svc.acknowledge_event(event_id, current_user.username)
    if result is None:
        raise HTTPException(status_code=404, detail="Alert-Event nicht gefunden")
    return AcknowledgeResponse(**result)


# ── SMTP Config (Admin, Plus-only) ────────────────────────────────────────────

smtp_router = APIRouter(prefix="/api/admin/alerts", tags=["alerts-admin"])


@smtp_router.get("/smtp", response_model=SmtpConfigResponse)
async def get_smtp_config(
    _: CurrentUser = Depends(require_admin),
) -> SmtpConfigResponse:
    _require_plus()
    config = await svc.get_smtp_config()
    return SmtpConfigResponse(**config)


@smtp_router.put("/smtp", response_model=SmtpConfigResponse)
async def update_smtp_config(
    body: SmtpConfigUpdateRequest,
    _: CurrentUser = Depends(require_admin),
) -> SmtpConfigResponse:
    _require_plus()
    config = await svc.update_smtp_config(body.model_dump(exclude_unset=True))
    return SmtpConfigResponse(**config)
