# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Cleanup-Hooks für den Approval-Workflow.

Hooks:
1. on_user_delete()           – User gelöscht: Anträge cancelln, User aus Regeln entfernen
2. on_group_delete()          – Gruppe gelöscht: Gruppe aus Regeln entfernen
3. on_playbook_delete()       – Playbook gelöscht: Anträge + Regel löschen
4. on_packer_template_delete() – Packer-Template gelöscht: analog Playbook
5. on_vm_lxc_delete()         – VM/LXC direkt gelöscht: relevante Anträge cancelln
6. (Regel-Update-Hook ist in rules_service._suspend_pending_for_rule integriert)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── 1. User-Delete ────────────────────────────────────────────────────────────

async def on_user_delete(user_id: int, actor_username: str) -> int:
    """Cancelln aller pending Anträge des Users; User aus Approver-Listen entfernen."""
    now = _now()

    async with get_db() as db:
        # Pending Anträge des Users cancelln
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE requester_user_id=:uid AND status IN ('pending', 'suspended')
            """),
            {"uid": user_id},
        )
        ids = [r[0] for r in result.fetchall()]

        if ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='cancelled', decided_at=:now, payload_secret_blob=NULL,
                           decided_reason='requester_deleted'
                     WHERE requester_user_id=:uid AND status IN ('pending', 'suspended')
                """),
                {"uid": user_id, "now": now},
            )

        # User aus approver_users aller Regeln entfernen
        result2 = await db.execute(
            text("SELECT id, approver_users, approver_groups FROM approval_rules")
        )
        rules = result2.fetchall()

        for rule in rules:
            rule_id = rule[0]
            try:
                au = json.loads(rule[1] or "[]")
            except Exception:
                au = []
            if user_id in au:
                new_au = [u for u in au if u != user_id]
                # Prüfen ob Regel danach noch Approver hat
                try:
                    ag = json.loads(rule[2] or "[]")
                except Exception:
                    ag = []
                await db.execute(
                    text("UPDATE approval_rules SET approver_users=:au WHERE id=:id"),
                    {"au": json.dumps(new_au), "id": rule_id},
                )
                if not new_au and not ag:
                    # Keine Approver mehr: Regel deaktivieren
                    await db.execute(
                        text("UPDATE approval_rules SET is_active=0 WHERE id=:id"),
                        {"id": rule_id},
                    )
                    await write_audit_log(
                        "approval_rule_auto_disabled", "system", "local",
                        detail=json.dumps({
                            "rule_id": rule_id,
                            "reason": "approver_user_deleted_no_approver_left",
                        })
                    )

        await db.commit()

    for approval_id in ids:
        await write_audit_log(
            "approval_cancelled", actor_username, "local",
            detail=json.dumps({
                "approval_id": approval_id,
                "reason": "requester_deleted",
            })
        )
    return len(ids)


# ── 2. Group-Delete ───────────────────────────────────────────────────────────

async def on_group_delete(group_id: int, actor_username: str) -> int:
    """Gruppe aus allen Approver-Regeln entfernen. Regeln ohne Approver deaktivieren."""
    now = _now()

    async with get_db() as db:
        result = await db.execute(
            text("SELECT id, approver_groups, approver_users FROM approval_rules")
        )
        rules = result.fetchall()

        for rule in rules:
            rule_id = rule[0]
            try:
                ag = json.loads(rule[1] or "[]")
            except Exception:
                ag = []
            if group_id in ag:
                new_ag = [g for g in ag if g != group_id]
                try:
                    au = json.loads(rule[2] or "[]")
                except Exception:
                    au = []
                await db.execute(
                    text("UPDATE approval_rules SET approver_groups=:ag, updated_at=:now WHERE id=:id"),
                    {"ag": json.dumps(new_ag), "now": now, "id": rule_id},
                )
                if not new_ag and not au:
                    # Fallback auf default_approver_group_id
                    from backend.plus.approvals.rules_service import get_default_approver_group_id
                    default_group = await get_default_approver_group_id()
                    if not default_group:
                        await db.execute(
                            text("UPDATE approval_rules SET is_active=0, updated_at=:now WHERE id=:id"),
                            {"now": now, "id": rule_id},
                        )
                        await write_audit_log(
                            "approval_rule_auto_disabled", "system", "local",
                            detail=json.dumps({
                                "rule_id": rule_id,
                                "reason": "approver_group_deleted_no_default",
                            })
                        )

        await db.commit()
    return 0  # Keine Anträge betroffen, aber Regeln ggf. deaktiviert


# ── 3. Playbook-Delete ────────────────────────────────────────────────────────

async def on_playbook_delete(playbook_name: str, actor_username: str) -> int:
    """Pending Anträge dieses Playbooks cancelln + Regel löschen."""
    now = _now()
    action_type = "playbook_run"
    action_target = playbook_name

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE action_type=:at AND action_target=:tgt
                   AND status IN ('pending', 'suspended')
            """),
            {"at": action_type, "tgt": action_target},
        )
        ids = [r[0] for r in result.fetchall()]

        if ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='cancelled', decided_at=:now, payload_secret_blob=NULL,
                           decided_reason='target_deleted'
                     WHERE action_type=:at AND action_target=:tgt
                       AND status IN ('pending', 'suspended')
                """),
                {"at": action_type, "tgt": action_target, "now": now},
            )

        # Regel löschen
        await db.execute(
            text("""
                DELETE FROM approval_rules
                 WHERE action_type=:at AND action_target=:tgt
            """),
            {"at": action_type, "tgt": action_target},
        )
        await db.commit()

    for approval_id in ids:
        await write_audit_log(
            "approval_cancelled", actor_username, "local",
            detail=json.dumps({
                "approval_id": approval_id,
                "reason": "target_deleted",
            })
        )
    return len(ids)


# ── 4. Packer-Template-Delete ─────────────────────────────────────────────────

async def on_packer_template_delete(template_name: str, actor_username: str) -> int:
    """Analog Playbook-Delete für Packer-Templates."""
    now = _now()
    action_type = "packer_build"
    action_target = template_name

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE action_type=:at AND action_target=:tgt
                   AND status IN ('pending', 'suspended')
            """),
            {"at": action_type, "tgt": action_target},
        )
        ids = [r[0] for r in result.fetchall()]

        if ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='cancelled', decided_at=:now, payload_secret_blob=NULL,
                           decided_reason='target_deleted'
                     WHERE action_type=:at AND action_target=:tgt
                       AND status IN ('pending', 'suspended')
                """),
                {"at": action_type, "tgt": action_target, "now": now},
            )

        await db.execute(
            text("""
                DELETE FROM approval_rules
                 WHERE action_type=:at AND action_target=:tgt
            """),
            {"at": action_type, "tgt": action_target},
        )
        await db.commit()

    for approval_id in ids:
        await write_audit_log(
            "approval_cancelled", actor_username, "local",
            detail=json.dumps({
                "approval_id": approval_id,
                "reason": "target_deleted",
            })
        )
    return len(ids)


# ── 5. VM/LXC-Delete (parallele Sofort-Löschung) ─────────────────────────────

async def on_vm_lxc_delete(
    node_id: str,
    vmid: int,
    actor_username: str = "system",
) -> int:
    """Cancelln aller pending vm_delete/lxc_delete/template_delete Anträge für diese Ressource."""
    now = _now()
    relevant_types = ("vm_delete", "lxc_delete", "template_delete",
                      "owner_delete_request", "owner_adopt_request")

    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE action_type IN ('vm_delete','lxc_delete','template_delete',
                                       'owner_delete_request','owner_adopt_request')
                   AND status IN ('pending', 'suspended')
                   AND json_extract(payload, '$.node_id') = :nid
                   AND json_extract(payload, '$.vmid') = :vmid
            """),
            {"nid": node_id, "vmid": vmid},
        )
        ids = [r[0] for r in result.fetchall()]

        if ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='cancelled', decided_at=:now, payload_secret_blob=NULL,
                           decided_reason='target_deleted'
                     WHERE id IN ({})
                """.format(",".join(f"'{i}'" for i in ids))),
                {"now": now},
            )
            await db.commit()

    for approval_id in ids:
        await write_audit_log(
            "approval_cancelled", actor_username, "local",
            detail=json.dumps({
                "approval_id": approval_id,
                "reason": "target_deleted",
            })
        )
    return len(ids)
