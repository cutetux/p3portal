# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Business-Logik für Approval-Anträge.

Zuständigkeiten:
- Antrag erstellen (create_approval)
- Antrag entscheiden: approve, reject
- Antrag zurückziehen: cancel
- Antrag neu einreichen: resubmit
- Expire-Sweep (on-demand + Celery)
- Master-Toggle Enable/Disable-Flow
"""
from __future__ import annotations

import json
import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from backend.db.database import get_db
from backend.plus.approvals import secret_masking
from backend.plus.approvals.rules_service import (
    get_allow_self_approval_global,
    get_default_expiration_hours,
    get_rule_for_action,
    is_approval_workflow_enabled,
)
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

ULID_CHARS = string.ascii_lowercase + string.digits


def _generate_id() -> str:
    """Erzeugt eine appr_-prefixed ID (30 Zeichen gesamt)."""
    return "appr_" + "".join(secrets.choice(ULID_CHARS) for _ in range(25))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    d = dict(row)
    for json_field in ("payload", "rule_snapshot"):
        if json_field in d and isinstance(d[json_field], str):
            try:
                d[json_field] = json.loads(d[json_field])
            except (json.JSONDecodeError, TypeError):
                d[json_field] = {}
    return d


# ── Antrag erstellen ──────────────────────────────────────────────────────────

async def create_approval(
    action_type: str,
    action_target: str,
    original_payload: dict[str, Any],
    requester_user_id: int,
    requester_username: str,
    meta_fields: list[dict] | None = None,
) -> dict:
    """Erstellt einen neuen Approval-Antrag.

    Prüft ob Workflow aktiv und Regel required=true ist.
    Gibt den Antrag zurück oder wirft ValueError("approval_not_required") wenn nicht nötig.
    """
    if not await is_approval_workflow_enabled():
        raise ValueError("approval_not_required")

    rule = await get_rule_for_action(action_type, action_target)
    if rule is None or not rule.get("required"):
        raise ValueError("approval_not_required")

    # Payload maskieren
    public_payload, secret_dict = secret_masking.split_payload(original_payload, meta_fields)
    payload_hash_val = secret_masking.payload_hash(original_payload)
    encrypted_blob = secret_masking.encrypt_secrets(secret_dict)

    # expires_at berechnen (Snapshot-Semantik)
    exp_hours = rule.get("expiration_hours") or await get_default_expiration_hours()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=exp_hours)).isoformat()

    approval_id = _generate_id()
    now = _now()

    async with get_db() as db:
        await db.execute(
            text("""
                INSERT INTO pending_approvals
                    (id, action_type, action_target, payload, payload_hash,
                     payload_secret_blob, requester_user_id, requested_at,
                     expires_at, status, rule_snapshot)
                VALUES (:id, :at, :tgt, :payload, :hash, :blob, :uid,
                        :now, :exp, 'pending', :snapshot)
            """),
            {
                "id": approval_id,
                "at": action_type,
                "tgt": action_target,
                "payload": json.dumps(public_payload),
                "hash": payload_hash_val,
                "blob": encrypted_blob,
                "uid": requester_user_id,
                "now": now,
                "exp": expires_at,
                "snapshot": json.dumps(rule),
            },
        )
        await db.commit()

    await write_audit_log(
        "approval_requested", requester_username, "local",
        detail=json.dumps({
            "approval_id": approval_id,
            "action_type": action_type,
            "action_target": action_target,
            "payload_hash": payload_hash_val,
            "rule_snapshot": rule,
        })
    )

    return await get_approval(approval_id)


# ── Antrag lesen ──────────────────────────────────────────────────────────────

async def get_approval(approval_id: str) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM pending_approvals WHERE id = :id"),
            {"id": approval_id},
        )
        row = result.mappings().fetchone()
    return _row_to_dict(dict(row)) if row else None


async def list_approvals(
    status: str | None = None,
    action_type: str | None = None,
    requester_user_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Listet Anträge mit Filtern. Gibt (items, total) zurück."""
    conditions = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}

    if status:
        conditions.append("status = :status")
        params["status"] = status
    if action_type:
        conditions.append("action_type = :action_type")
        params["action_type"] = action_type
    if requester_user_id:
        conditions.append("requester_user_id = :requester_user_id")
        params["requester_user_id"] = requester_user_id

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT * FROM pending_approvals
         {where}
         ORDER BY requested_at DESC
         LIMIT :limit OFFSET :offset
    """
    count_sql = f"SELECT COUNT(*) FROM pending_approvals {where}"

    async with get_db() as db:
        result = await db.execute(text(sql), params)
        rows = result.mappings().fetchall()
        count_result = await db.execute(text(count_sql), {k: v for k, v in params.items() if k not in ("limit", "offset")})
        total = count_result.scalar() or 0

    return [_row_to_dict(dict(r)) for r in rows], total


async def count_pending_for_user(user_id: int, username: str) -> int:
    """Zählt pending Anträge die der User entscheiden kann (für Sidebar-Badge)."""
    from backend.plus.approvals.permissions import count_approvable_for_user
    return await count_approvable_for_user(user_id, username)


# ── Antrag entscheiden ────────────────────────────────────────────────────────

async def approve_approval(
    approval_id: str,
    decider_user_id: int,
    decider_username: str,
    reason: str | None = None,
) -> dict:
    """Genehmigt einen Antrag und führt den Handler aus."""
    approval = await get_approval(approval_id)
    if approval is None:
        raise ValueError("approval_not_found")
    if approval["status"] != "pending":
        raise ValueError("not_pending")

    rule_snapshot = approval.get("rule_snapshot") or {}
    is_own = approval.get("requester_user_id") == decider_user_id

    # Self-Approval-Check
    if is_own:
        self_allowed = rule_snapshot.get("allow_self_approval", False)
        if not plus_behavior.allow_self_approval_supported():
            self_allowed = False
        if not self_allowed:
            raise ValueError("self_approval_disabled")
        if not reason or len(reason.strip()) < 10:
            raise ValueError("self_approval_reason_required")

    now = _now()
    async with get_db() as db:
        # Status auf approved setzen
        await db.execute(
            text("""
                UPDATE pending_approvals
                   SET status='approved', decided_by_user_id=:uid, decided_at=:now,
                       decided_reason=:reason, self_approval=:sa
                 WHERE id=:id AND status='pending'
            """),
            {
                "uid": decider_user_id, "now": now, "reason": reason or "",
                "sa": 1 if is_own else 0, "id": approval_id,
            },
        )
        await db.commit()

    await write_audit_log(
        "approval_approved", decider_username, "local",
        detail=json.dumps({
            "approval_id": approval_id,
            "decided_reason": reason,
            "self_approval": is_own,
        })
    )

    # Execute-Handler aufrufen
    approval_fresh = await get_approval(approval_id)
    assert approval_fresh is not None

    # Secret-Payload entschlüsseln
    blob = approval_fresh.get("payload_secret_blob")
    secret_dict = secret_masking.decrypt_secrets(blob) if blob else {}
    full_payload = secret_masking.merge_payload(approval_fresh["payload"], secret_dict)

    try:
        from backend.plus.approvals.handlers import execute_handler
        job_id = await execute_handler(
            approval_fresh["action_type"],
            approval_fresh,
            full_payload,
            decider_username,
        )
    except Exception as exc:
        logger.error("PROJ-50: Execute-Handler fehlgeschlagen für %s: %s", approval_id, exc)
        # Approval bleibt 'approved', Job-Fehler ist separater Status
        await _clear_secret_blob(approval_id)
        raise

    # Status auf executed, job_id setzen, blob löschen
    async with get_db() as db:
        await db.execute(
            text("""
                UPDATE pending_approvals
                   SET status='executed', job_id=:job_id, payload_secret_blob=NULL
                 WHERE id=:id
            """),
            {"job_id": job_id, "id": approval_id},
        )
        await db.commit()

    await write_audit_log(
        "approval_executed", decider_username, "local",
        detail=json.dumps({"approval_id": approval_id, "job_id": job_id})
    )

    return await get_approval(approval_id)


async def reject_approval(
    approval_id: str,
    decider_user_id: int,
    decider_username: str,
    reason: str,
) -> dict:
    """Lehnt einen Antrag ab."""
    approval = await get_approval(approval_id)
    if approval is None:
        raise ValueError("approval_not_found")
    if approval["status"] != "pending":
        raise ValueError("not_pending")

    now = _now()
    async with get_db() as db:
        await db.execute(
            text("""
                UPDATE pending_approvals
                   SET status='rejected', decided_by_user_id=:uid, decided_at=:now,
                       decided_reason=:reason, payload_secret_blob=NULL
                 WHERE id=:id AND status='pending'
            """),
            {"uid": decider_user_id, "now": now, "reason": reason, "id": approval_id},
        )
        await db.commit()

    await write_audit_log(
        "approval_rejected", decider_username, "local",
        detail=json.dumps({"approval_id": approval_id, "decided_reason": reason})
    )
    return await get_approval(approval_id)


# ── Cancel ────────────────────────────────────────────────────────────────────

async def cancel_approval(
    approval_id: str,
    requester_user_id: int,
    requester_username: str,
) -> dict:
    """Zieht einen Antrag zurück (nur für Requester, Status pending/suspended)."""
    approval = await get_approval(approval_id)
    if approval is None:
        raise ValueError("approval_not_found")
    if approval["status"] not in ("pending", "suspended"):
        raise ValueError("not_cancellable")

    now = _now()
    async with get_db() as db:
        await db.execute(
            text("""
                UPDATE pending_approvals
                   SET status='cancelled', decided_by_user_id=:uid, decided_at=:now,
                       decided_reason='cancelled_by_requester', payload_secret_blob=NULL
                 WHERE id=:id AND status IN ('pending', 'suspended')
            """),
            {"uid": requester_user_id, "now": now, "id": approval_id},
        )
        await db.commit()

    await write_audit_log(
        "approval_cancelled", requester_username, "local",
        detail=json.dumps({
            "approval_id": approval_id,
            "reason": "cancelled_by_requester",
        })
    )
    return await get_approval(approval_id)


# ── Resubmit ──────────────────────────────────────────────────────────────────

async def resubmit_approval(
    approval_id: str,
    requester_user_id: int,
    requester_username: str,
    payload_overrides: dict[str, Any],
    meta_fields: list[dict] | None = None,
) -> dict:
    """Erstellt einen neuen Antrag basierend auf einem rejected/suspended Antrag."""
    old_approval = await get_approval(approval_id)
    if old_approval is None:
        raise ValueError("approval_not_found")
    if old_approval["status"] not in ("rejected", "suspended"):
        raise ValueError("resubmit_only_for_rejected_or_suspended")

    # Aktuelle Regel laden (nicht den alten Snapshot)
    rule = await get_rule_for_action(
        old_approval["action_type"], old_approval["action_target"]
    )

    # Alten Payload mit Overrides mergen
    old_public = old_approval.get("payload") or {}
    merged_payload = {**old_public, **payload_overrides}
    # Secrets aus altem Blob entschlüsseln und einmergen
    blob = old_approval.get("payload_secret_blob")
    if blob:
        old_secrets = secret_masking.decrypt_secrets(blob)
        merged_payload.update(old_secrets)

    # Neuen Antrag anlegen mit parent_approval_id
    public_payload, secret_dict = secret_masking.split_payload(merged_payload, meta_fields)
    payload_hash_val = secret_masking.payload_hash(merged_payload)
    encrypted_blob = secret_masking.encrypt_secrets(secret_dict)

    exp_hours = (rule or {}).get("expiration_hours") or await get_default_expiration_hours()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=exp_hours)).isoformat()
    new_id = _generate_id()
    now = _now()

    async with get_db() as db:
        await db.execute(
            text("""
                INSERT INTO pending_approvals
                    (id, action_type, action_target, payload, payload_hash,
                     payload_secret_blob, requester_user_id, requested_at,
                     expires_at, status, rule_snapshot, parent_approval_id)
                VALUES (:id, :at, :tgt, :payload, :hash, :blob, :uid,
                        :now, :exp, 'pending', :snapshot, :parent)
            """),
            {
                "id": new_id,
                "at": old_approval["action_type"],
                "tgt": old_approval["action_target"],
                "payload": json.dumps(public_payload),
                "hash": payload_hash_val,
                "blob": encrypted_blob,
                "uid": requester_user_id,
                "now": now,
                "exp": expires_at,
                "snapshot": json.dumps(rule) if rule else "{}",
                "parent": approval_id,
            },
        )
        await db.commit()

    await write_audit_log(
        "approval_requested", requester_username, "local",
        detail=json.dumps({
            "approval_id": new_id,
            "parent_approval_id": approval_id,
            "action_type": old_approval["action_type"],
        })
    )
    return await get_approval(new_id)


# ── Expire-Sweep ──────────────────────────────────────────────────────────────

async def expire_overdue_approvals() -> int:
    """Setzt alle abgelaufenen pending-Anträge auf expired. Gibt Anzahl zurück."""
    now = _now()
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE status='pending' AND expires_at < :now
            """),
            {"now": now},
        )
        ids = [r[0] for r in result.fetchall()]

        if ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='expired', decided_at=:now, payload_secret_blob=NULL
                     WHERE status='pending' AND expires_at < :now
                """),
                {"now": now},
            )
            await db.commit()

    for approval_id in ids:
        await write_audit_log(
            "approval_expired", "system", "local",
            detail=json.dumps({"approval_id": approval_id, "expired_at": now})
        )

    return len(ids)


# ── Master-Toggle ─────────────────────────────────────────────────────────────

async def enable_workflow(actor_user_id: int, actor_username: str) -> dict:
    """Schaltet den Approval-Workflow ein (false → true)."""
    now = _now()

    # Schedules mit approval-pflichtigen Aktionen in Plus-Tabelle suspendieren
    async with get_db() as db:
        result = await db.execute(
            text("""
                INSERT OR IGNORE INTO scheduled_job_approval_status
                    (scheduled_job_id, status, reason, updated_at)
                SELECT sj.id, 'suspended', 'workflow_enabled', :now
                  FROM scheduled_jobs sj
                 WHERE sj.active=1
                   AND NOT EXISTS (
                       SELECT 1 FROM scheduled_job_approval_status
                        WHERE scheduled_job_id = sj.id
                   )
                   AND EXISTS (
                       SELECT 1 FROM approval_rules ar
                        WHERE ar.is_active=1 AND ar.required=1
                          AND (
                              ar.action_type = json_extract(sj.config, '$.action_type')
                              OR ar.action_type = 'playbook_run'
                          )
                   )
            """),
            {"now": now},
        )
        suspended_count = result.rowcount or 0

        # Master-Toggle: Zeile id=1 anlegen falls noch nicht vorhanden, dann setzen
        await db.execute(
            text("""
                INSERT OR IGNORE INTO approval_workflow_config
                    (id, enabled, default_expiration_hours, allow_self_approval_global)
                VALUES (1, 0, 48, 0)
            """)
        )
        await db.execute(
            text("""
                UPDATE approval_workflow_config
                   SET enabled=1, updated_at=:now, updated_by_user_id=:uid
                 WHERE id=1
            """),
            {"now": now, "uid": actor_user_id},
        )
        await db.commit()

    await write_audit_log(
        "approval_workflow_enabled", actor_username, "local",
        detail=json.dumps({
            "actor": actor_username,
            "affected_schedules_count": suspended_count,
        })
    )

    return {"enabled": True, "suspended_schedules_count": suspended_count}


async def disable_workflow(actor_user_id: int, actor_username: str) -> dict:
    """Schaltet den Approval-Workflow aus (true → false). Führt als Transaktion aus."""
    now = _now()
    affected_count = 0
    reactivated_count = 0

    async with get_db() as db:
        # 1. Alle pending + suspended Anträge cancelln
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE status IN ('pending', 'suspended')
            """)
        )
        affected_ids = [r[0] for r in result.fetchall()]
        affected_count = len(affected_ids)

        if affected_ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='cancelled', decided_at=:now, payload_secret_blob=NULL,
                           decided_reason='workflow_disabled'
                     WHERE status IN ('pending', 'suspended')
                """),
                {"now": now},
            )

        # 2. Schedules reaktivieren (Plus-Tabelle löschen)
        result2 = await db.execute(
            text("""
                DELETE FROM scheduled_job_approval_status
                 WHERE status IN ('pending_approval', 'suspended')
            """)
        )
        reactivated_count = result2.rowcount or 0

        # Master-Toggle: Zeile id=1 anlegen falls noch nicht vorhanden, dann deaktivieren
        await db.execute(
            text("""
                INSERT OR IGNORE INTO approval_workflow_config
                    (id, enabled, default_expiration_hours, allow_self_approval_global)
                VALUES (1, 0, 48, 0)
            """)
        )
        await db.execute(
            text("""
                UPDATE approval_workflow_config
                   SET enabled=0, updated_at=:now, updated_by_user_id=:uid
                 WHERE id=1
            """),
            {"now": now, "uid": actor_user_id},
        )
        await db.commit()

    # Per-Antrag Audit-Events
    for approval_id in affected_ids:
        await write_audit_log(
            "approval_cancelled", "system", "local",
            detail=json.dumps({
                "approval_id": approval_id,
                "reason": "workflow_disabled",
            })
        )

    await write_audit_log(
        "approval_workflow_disabled", actor_username, "local",
        detail=json.dumps({
            "actor": actor_username,
            "affected_approvals_count": affected_count,
            "reactivated_schedules_count": reactivated_count,
        })
    )

    return {
        "enabled": False,
        "affected_approvals_count": affected_count,
        "reactivated_schedules_count": reactivated_count,
    }


# ── Helper ────────────────────────────────────────────────────────────────────

async def _clear_secret_blob(approval_id: str) -> None:
    async with get_db() as db:
        await db.execute(
            text("UPDATE pending_approvals SET payload_secret_blob=NULL WHERE id=:id"),
            {"id": approval_id},
        )
        await db.commit()
