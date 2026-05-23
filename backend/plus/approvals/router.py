# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: FastAPI-Router für den Approval-Workflow.

13 Endpoints:
  Anträge (9):
    GET    /api/approvals                  – Liste (Admin: alle, User: eigene + approvable)
    POST   /api/approvals                  – Antrag erstellen (intern, vom Workflow aufgerufen)
    GET    /api/approvals/count            – Anzahl für Sidebar-Badge
    GET    /api/approvals/config           – Workflow-Status (alle auth. Nutzer)
    GET    /api/approvals/{id}             – Einzelantrag
    POST   /api/approvals/{id}/approve     – Genehmigen
    POST   /api/approvals/{id}/reject      – Ablehnen
    POST   /api/approvals/{id}/cancel      – Zurückziehen
    POST   /api/approvals/{id}/resubmit    – Neu einreichen

  Regeln (4):
    GET    /api/approval-rules             – Liste
    POST   /api/approval-rules             – Erstellen (Admin)
    PATCH  /api/approval-rules/{id}        – Aktualisieren (Admin)
    DELETE /api/approval-rules/{id}        – Löschen (Admin)

  Master-Toggle (2):
    GET    /api/admin/approval-workflow    – Status abfragen
    POST   /api/admin/approval-workflow    – Ein-/Ausschalten
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.features.api_surface.deps import require_scope_for_upk
from backend.plus.approvals import service, rules_service
from backend.plus.approvals.permissions import can_user_approve
from backend.plus.approvals.schemas import (
    ApprovalCountResponse,
    ApprovalListResponse,
    ApprovalResponse,
    ApprovalRuleCreate,
    ApprovalRuleResponse,
    ApprovalRuleUpdate,
    ApprovalWorkflowConfig,
    ApprovalWorkflowToggle,
    ApproveRequest,
    RejectRequest,
    ResubmitRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["approvals"])

_require_admin = require_admin_or("manage_users")


def _user_id_required(current_user: CurrentUser) -> int:
    """Wirft 401 wenn keine user_id (Proxmox-Auth ohne lokalen DB-Eintrag)."""
    if current_user.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Approval-Workflow erfordert lokale Authentifizierung",
        )
    return current_user.user_id


# ── Anträge ───────────────────────────────────────────────────────────────────

@router.get("/api/approvals", response_model=ApprovalListResponse)
async def list_approvals(
    filter_status: str | None = Query(None, alias="status"),
    action_type: str | None = Query(None),
    mine: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("approvals:read")),
):
    """Listet Anträge. Admin/manage_users sieht alle, sonst nur eigene + entscheidbare."""
    is_admin = (
        current_user.role == "admin"
        or "manage_users" in (current_user.portal_permissions or [])
    )
    user_id = current_user.user_id

    requester_filter = None
    if mine and user_id:
        requester_filter = user_id
    elif not is_admin and user_id:
        requester_filter = user_id

    items, total = await service.list_approvals(
        status=filter_status,
        action_type=action_type,
        requester_user_id=requester_filter,
        limit=limit,
        offset=offset,
    )

    # can_approve + is_own_request anreichern
    enriched = []
    for item in items:
        can_approve = False
        if user_id:
            snapshot = item.get("rule_snapshot") or {}
            can_approve = await can_user_approve(
                user_id, current_user.portal_permissions or [], snapshot
            )
        enriched.append({
            **item,
            "can_approve": can_approve,
            "is_own_request": (user_id is not None and item.get("requester_user_id") == user_id),
        })

    return ApprovalListResponse(items=enriched, total=total)


@router.get("/api/approvals/count", response_model=ApprovalCountResponse)
async def get_approval_count(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Zählt entscheidbare Anträge für Sidebar-Badge."""
    user_id = current_user.user_id
    if user_id is None:
        return ApprovalCountResponse(count=0)
    count = await service.count_pending_for_user(user_id, current_user.username)
    return ApprovalCountResponse(count=count)


@router.get("/api/approvals/config", response_model=ApprovalWorkflowConfig)
async def get_approvals_config(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Gibt den Approval-Workflow-Status zurück (alle authentifizierten Nutzer).

    Wird vom Frontend genutzt um zu entscheiden ob Approval-UI angezeigt wird.
    Für Admin-Aktionen (Toggle, Regel-Verwaltung) → /api/admin/approval-workflow.
    """
    from backend.core.plus_protocol import plus_behavior

    enabled = await rules_service.is_approval_workflow_enabled()
    default_group_id = await rules_service.get_default_approver_group_id()
    default_exp_hours = await rules_service.get_default_expiration_hours()
    allow_self_global = await rules_service.get_allow_self_approval_global()
    max_rules = plus_behavior.get_max_approval_rules()
    allow_self_supported = plus_behavior.allow_self_approval_supported()

    return ApprovalWorkflowConfig(
        enabled=enabled,
        default_approver_group_id=default_group_id,
        default_expiration_hours=default_exp_hours,
        allow_self_approval_global=allow_self_global,
        max_approval_rules=max_rules,
        allow_self_approval_supported=allow_self_supported,
    )


@router.get("/api/approvals/{approval_id}", response_model=ApprovalResponse)
async def get_approval(
    approval_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("approvals:read")),
):
    """Gibt einen Antrag zurück. Admins sehen alle, User nur eigene/entscheidbare."""
    approval = await service.get_approval(approval_id)
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden")

    user_id = current_user.user_id
    is_admin = (
        current_user.role == "admin"
        or "manage_users" in (current_user.portal_permissions or [])
    )

    can_approve = False
    if user_id:
        can_approve = await can_user_approve(
            user_id, current_user.portal_permissions or [],
            approval.get("rule_snapshot") or {},
        )

    is_own = user_id is not None and approval.get("requester_user_id") == user_id

    if not is_admin and not can_approve and not is_own:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Kein Zugriff")

    # Soft-Trigger für Expire-Sweep
    if approval.get("status") == "pending":
        from backend.plus.approvals.service import expire_overdue_approvals
        import asyncio
        asyncio.ensure_future(expire_overdue_approvals())

    return ApprovalResponse(**{**approval, "can_approve": can_approve, "is_own_request": is_own})


@router.post("/api/approvals/{approval_id}/approve", response_model=ApprovalResponse)
async def approve_approval(
    approval_id: str,
    body: ApproveRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("approvals:approve")),
):
    """Genehmigt einen Antrag. Prüft can_user_approve."""
    user_id = _user_id_required(current_user)

    approval = await service.get_approval(approval_id)
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden")

    can_approve = await can_user_approve(
        user_id, current_user.portal_permissions or [],
        approval.get("rule_snapshot") or {},
    )
    if not can_approve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Genehmigungsberechtigung")

    try:
        updated = await service.approve_approval(
            approval_id=approval_id,
            decider_user_id=user_id,
            decider_username=current_user.username,
            reason=body.reason,
        )
    except ValueError as exc:
        _map_value_error(exc)
    except Exception as exc:
        logger.error("approve_approval Fehler: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    is_own = updated.get("requester_user_id") == user_id
    return ApprovalResponse(**{**updated, "can_approve": False, "is_own_request": is_own})


@router.post("/api/approvals/{approval_id}/reject", response_model=ApprovalResponse)
async def reject_approval(
    approval_id: str,
    body: RejectRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("approvals:approve")),
):
    """Lehnt einen Antrag ab. Prüft can_user_approve."""
    user_id = _user_id_required(current_user)

    approval = await service.get_approval(approval_id)
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden")

    can_approve = await can_user_approve(
        user_id, current_user.portal_permissions or [],
        approval.get("rule_snapshot") or {},
    )
    if not can_approve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Ablehnungsberechtigung")

    try:
        updated = await service.reject_approval(
            approval_id=approval_id,
            decider_user_id=user_id,
            decider_username=current_user.username,
            reason=body.reason,
        )
    except ValueError as exc:
        _map_value_error(exc)

    is_own = updated.get("requester_user_id") == user_id
    return ApprovalResponse(**{**updated, "can_approve": False, "is_own_request": is_own})


@router.post("/api/approvals/{approval_id}/cancel", response_model=ApprovalResponse)
async def cancel_approval(
    approval_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Zieht einen Antrag zurück. Nur Requester kann canceln."""
    user_id = _user_id_required(current_user)

    approval = await service.get_approval(approval_id)
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden")

    if approval.get("requester_user_id") != user_id:
        is_admin = (
            current_user.role == "admin"
            or "manage_users" in (current_user.portal_permissions or [])
        )
        if not is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nur der Antragsteller kann stornieren")

    try:
        updated = await service.cancel_approval(
            approval_id=approval_id,
            requester_user_id=user_id,
            requester_username=current_user.username,
        )
    except ValueError as exc:
        _map_value_error(exc)

    return ApprovalResponse(**{**updated, "can_approve": False, "is_own_request": True})


@router.post("/api/approvals/{approval_id}/resubmit", response_model=ApprovalResponse, status_code=status.HTTP_201_CREATED)
async def resubmit_approval(
    approval_id: str,
    body: ResubmitRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Erstellt einen neuen Antrag basierend auf einem rejected/suspended Antrag."""
    user_id = _user_id_required(current_user)

    approval = await service.get_approval(approval_id)
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden")

    if approval.get("requester_user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nur der ursprüngliche Antragsteller kann neu einreichen")

    try:
        new_approval = await service.resubmit_approval(
            approval_id=approval_id,
            requester_user_id=user_id,
            requester_username=current_user.username,
            payload_overrides=body.payload_overrides or {},
        )
    except ValueError as exc:
        _map_value_error(exc)

    return ApprovalResponse(**{**new_approval, "can_approve": False, "is_own_request": True})


# ── Regeln ────────────────────────────────────────────────────────────────────

@router.get("/api/approval-rules", response_model=list[ApprovalRuleResponse])
async def list_rules(
    _: CurrentUser = Depends(_require_admin),
):
    """Liste aller Approval-Regeln (Admin-only)."""
    return await rules_service.list_rules()


@router.post("/api/approval-rules", response_model=ApprovalRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: ApprovalRuleCreate,
    current_user: CurrentUser = Depends(_require_admin),
):
    """Erstellt eine neue UI-Override-Regel (Admin-only)."""
    try:
        rule = await rules_service.create_rule(
            action_type=body.action_type,
            action_target=body.action_target,
            required=body.required,
            approver_groups=body.approver_groups or [],
            approver_users=body.approver_users or [],
            expiration_hours=body.expiration_hours,
            allow_self_approval=body.allow_self_approval,
            source="ui_override",
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
        )
    except ValueError as exc:
        _map_value_error(exc)

    return rule


@router.patch("/api/approval-rules/{rule_id}", response_model=ApprovalRuleResponse)
async def update_rule(
    rule_id: int,
    body: ApprovalRuleUpdate,
    current_user: CurrentUser = Depends(_require_admin),
):
    """Aktualisiert eine Approval-Regel (Admin-only). Suspendiert betroffene Anträge."""
    try:
        rule = await rules_service.update_rule(
            rule_id=rule_id,
            updates=body.model_dump(exclude_none=True),
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
        )
    except ValueError as exc:
        _map_value_error(exc)

    return rule


@router.delete("/api/approval-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: int,
    current_user: CurrentUser = Depends(_require_admin),
):
    """Löscht eine UI-Override-Regel (meta_yaml-Regeln können nicht gelöscht werden)."""
    try:
        await rules_service.delete_rule(
            rule_id=rule_id,
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
        )
    except ValueError as exc:
        _map_value_error(exc)


# ── Master-Toggle ─────────────────────────────────────────────────────────────

@router.get("/api/admin/approval-workflow", response_model=ApprovalWorkflowConfig)
async def get_workflow_config(
    _: CurrentUser = Depends(_require_admin),
):
    """Gibt den aktuellen Status des Approval-Workflows zurück."""
    from backend.services.config_service import get_config
    from backend.core.plus_protocol import plus_behavior

    enabled = await rules_service.is_approval_workflow_enabled()
    default_group_id = await rules_service.get_default_approver_group_id()
    default_exp_hours = await rules_service.get_default_expiration_hours()
    allow_self_global = await rules_service.get_allow_self_approval_global()
    max_rules = plus_behavior.get_max_approval_rules()
    allow_self_supported = plus_behavior.allow_self_approval_supported()

    return ApprovalWorkflowConfig(
        enabled=enabled,
        default_approver_group_id=default_group_id,
        default_expiration_hours=default_exp_hours,
        allow_self_approval_global=allow_self_global,
        max_approval_rules=max_rules,
        allow_self_approval_supported=allow_self_supported,
    )


@router.post("/api/admin/approval-workflow", response_model=ApprovalWorkflowConfig)
async def toggle_workflow(
    body: ApprovalWorkflowToggle,
    current_user: CurrentUser = Depends(_require_admin),
):
    """Schaltet den Master-Toggle ein oder aus. Disable-Flow ist transaktional."""
    from backend.core.plus_protocol import plus_behavior

    user_id = current_user.user_id or None

    if body.enabled:
        await service.enable_workflow(user_id, current_user.username)
    else:
        await service.disable_workflow(user_id, current_user.username)

    # Optionale Konfig-Updates in approval_workflow_config
    await rules_service.update_workflow_config(
        default_approver_group_id=body.default_approver_group_id,
        default_expiration_hours=body.default_expiration_hours,
        allow_self_approval_global=body.allow_self_approval_global,
        actor_user_id=current_user.user_id,
    )

    return await get_workflow_config(current_user)


# ── Error-Mapper ──────────────────────────────────────────────────────────────

def _map_value_error(exc: ValueError) -> None:
    msg = str(exc)
    error_map = {
        "approval_not_found": (status.HTTP_404_NOT_FOUND, "Antrag nicht gefunden"),
        "rule_not_found": (status.HTTP_404_NOT_FOUND, "Regel nicht gefunden"),
        "not_pending": (status.HTTP_409_CONFLICT, "Antrag ist nicht mehr offen"),
        "not_cancellable": (status.HTTP_409_CONFLICT, "Antrag kann nicht storniert werden"),
        "self_approval_disabled": (status.HTTP_403_FORBIDDEN, "Self-Approval ist für diesen Antrag nicht erlaubt"),
        "self_approval_reason_required": (422, "Begründung erforderlich für Self-Approval (min. 10 Zeichen)"),
        "core_limit_3_approval_rules": (status.HTTP_402_PAYMENT_REQUIRED, "Core-Edition: Maximal 3 aktive Pflichtregeln (Plus für unbegrenzte Regeln)"),
        "cannot_delete_meta_yaml_rule": (status.HTTP_409_CONFLICT, "Regeln aus meta.yaml können nicht manuell gelöscht werden"),
        "approval_rule_already_exists": (status.HTTP_409_CONFLICT, "Es existiert bereits eine Regel für diese Aktion"),
        "resubmit_only_for_rejected_or_suspended": (status.HTTP_409_CONFLICT, "Neu einreichen nur bei abgelehnten oder suspendierten Anträgen möglich"),
        "approval_not_required": (status.HTTP_400_BAD_REQUEST, "Für diese Aktion ist keine Genehmigung erforderlich"),
    }
    code, detail = error_map.get(msg, (status.HTTP_400_BAD_REQUEST, msg))
    raise HTTPException(status_code=code, detail=detail)
