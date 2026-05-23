# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-64: Approval-Workflow-Plus-Mixin.

Implementiert alle 12 Approval-Hooks für die Plus-Edition.
Delegiert an Sub-Services in backend/plus/approvals/.

Core-Imports (get_db, audit_service) sind erlaubt – sie sind infrastrukturell.
Import-Richtung: Plus → Core (OK), Core → Plus (verboten).
"""
from __future__ import annotations

import logging
from datetime import timezone

from backend.core.plus_protocol import ApprovalDecision

logger = logging.getLogger(__name__)


class ApprovalsPlusBehavior:
    """Plus-Mixin: vollständiger Approval-Workflow (PROJ-64)."""

    # ── Legacy-Limit-Hooks (bleiben für Plus-internen Code) ─────────────────

    def get_max_approval_rules(self) -> int | None:
        return None  # Plus: unbegrenzt

    def allow_self_approval_supported(self) -> bool:
        return True

    # ── Submit-Pfad ───────────────────────────────────────────────────────────

    async def requires_approval(
        self,
        action_type: str,
        payload: dict,
        user_id: int,
        username: str,
        meta_fields: list[dict] | None = None,
    ) -> ApprovalDecision | None:
        """Prüft ob Aktion Freigabe benötigt. Erstellt Antrag + returnt ApprovalDecision.

        None → sofort ausführen.
        ApprovalDecision → HTTP 202, Endpoint liefert Body.
        """
        from backend.plus.approvals import rules_service, service

        if not await rules_service.is_approval_workflow_enabled():
            return None

        action_target = _extract_action_target(action_type, payload)
        rule = await rules_service.get_rule_for_action(action_type, action_target)
        if rule is None or not rule.get("required"):
            return None

        try:
            approval = await service.create_approval(
                action_type=action_type,
                action_target=action_target,
                original_payload=payload,
                requester_user_id=user_id,
                requester_username=username,
                meta_fields=meta_fields,
            )
        except ValueError:
            # approval_not_required (race: Regel wurde zwischenzeitlich deaktiviert)
            return None

        from datetime import datetime
        expires_at_raw = approval.get("expires_at", "")
        try:
            expires_at = datetime.fromisoformat(expires_at_raw)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            from datetime import timedelta
            expires_at = datetime.now(timezone.utc) + timedelta(hours=48)

        return ApprovalDecision(
            approval_id=approval["id"],
            action_type=action_type,
            action_target=action_target,
            expires_at=expires_at,
            poll_url=f"/api/approvals/{approval['id']}",
        )

    # ── Master-Toggle (lesend) ────────────────────────────────────────────────

    async def is_approval_workflow_enabled(self) -> bool:
        from backend.plus.approvals import rules_service
        return await rules_service.is_approval_workflow_enabled()

    # ── Scheduled-Jobs-Filter ─────────────────────────────────────────────────

    async def get_approval_blocked_scheduled_job_ids(
        self, candidate_ids: set[str]
    ) -> set[str]:
        from backend.plus.approvals.scheduled_job_filter import (
            get_approval_blocked_scheduled_job_ids as _impl,
        )
        return await _impl(candidate_ids)

    # ── Discovery-Sync ────────────────────────────────────────────────────────

    async def sync_meta_yaml_approval_rule(
        self,
        action_type: str,
        action_target: str,
        approval_block: dict | None,
    ) -> None:
        from backend.plus.approvals import rules_service
        if approval_block is None:
            await rules_service.remove_meta_yaml_rule(action_type, action_target)
        else:
            await rules_service.sync_meta_yaml_rule(
                action_type=action_type,
                action_target=action_target,
                approval_block=approval_block,
            )

    # ── Cleanup-Hooks ─────────────────────────────────────────────────────────

    async def on_user_deleted_approval_workflow(
        self, user_id: int, actor_username: str
    ) -> int:
        from backend.plus.approvals import cleanup
        return await cleanup.on_user_delete(user_id, actor_username)

    async def on_group_deleted_approval_workflow(
        self, group_id: int, actor_username: str
    ) -> int:
        from backend.plus.approvals import cleanup
        return await cleanup.on_group_delete(group_id, actor_username)

    async def on_playbook_deleted_approval_workflow(
        self, playbook_name: str, actor_username: str
    ) -> int:
        from backend.plus.approvals import cleanup
        return await cleanup.on_playbook_delete(playbook_name, actor_username)

    async def on_packer_template_deleted_approval_workflow(
        self, template_name: str, actor_username: str
    ) -> int:
        from backend.plus.approvals import cleanup
        return await cleanup.on_packer_template_delete(template_name, actor_username)

    async def on_vm_lxc_deleted_approval_workflow(
        self, node_id: str, vmid: int, actor_username: str
    ) -> int:
        from backend.plus.approvals import cleanup
        return await cleanup.on_vm_lxc_delete(node_id, vmid, actor_username)

    async def on_approval_rule_updated(
        self, rule_id: int, old: dict, new: dict, actor: str
    ) -> int:
        from backend.plus.approvals import rules_service
        return await rules_service.on_rule_updated_suspend_pending(rule_id, old, new, actor)

    # ── Celery-Beat-Registration ──────────────────────────────────────────────

    def register_approval_celery_tasks(self, celery_app) -> None:
        from backend.plus.approvals import tasks as _tasks
        _tasks.register_approval_celery_tasks(celery_app)


def _extract_action_target(action_type: str, payload: dict) -> str:
    """Extrahiert den action_target aus dem Payload je nach action_type."""
    if action_type == "playbook_run":
        return str(payload.get("playbook_name", payload.get("playbook", "")))
    if action_type == "packer_build":
        return str(payload.get("template_id", payload.get("template_name", "")))
    if action_type in ("vm_delete", "lxc_delete", "template_delete"):
        node_id = payload.get("node_id", "")
        vmid = payload.get("vmid", "")
        return f"{node_id}:{vmid}"
    if action_type == "scheduled_job_creation":
        return str(payload.get("name", payload.get("job_name", "")))
    if action_type in ("owner_delete_request", "owner_adopt_request"):
        node_id = payload.get("node_id", "")
        vmid = payload.get("vmid", "")
        return f"{node_id}:{vmid}"
    return str(payload.get("target", ""))
