# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Service für approval_rules CRUD, Discovery-Sync und Suspended-Workflow."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

VALID_ACTION_TYPES = frozenset({
    "playbook_run", "packer_build", "vm_delete", "lxc_delete",
    "template_delete", "owner_delete_request", "owner_adopt_request",
})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    d = dict(row)
    for json_field in ("approver_groups", "approver_users", "meta_yaml_snapshot", "rule_snapshot"):
        if json_field in d and isinstance(d[json_field], str):
            try:
                d[json_field] = json.loads(d[json_field])
            except (json.JSONDecodeError, TypeError):
                d[json_field] = None
    return d


# ── approval_workflow_config helpers (PROJ-64: Single-Row-Tabelle) ────────────

async def _get_workflow_config() -> dict:
    """Liest approval_workflow_config (id=1). Gibt Defaults zurück wenn leer."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM approval_workflow_config WHERE id=1")
        )
        row = result.mappings().fetchone()
    if row is None:
        return {
            "enabled": False,
            "default_approver_group_id": None,
            "default_expiration_hours": 48,
            "allow_self_approval_global": False,
            "updated_at": None,
            "updated_by_user_id": None,
        }
    return dict(row)


async def is_approval_workflow_enabled() -> bool:
    """Prüft ob der Master-Toggle aktiviert ist."""
    config = await _get_workflow_config()
    return bool(config.get("enabled", False))


async def get_default_approver_group_id() -> int | None:
    config = await _get_workflow_config()
    return config.get("default_approver_group_id")


async def get_default_expiration_hours() -> int:
    config = await _get_workflow_config()
    try:
        return int(config.get("default_expiration_hours") or 48)
    except (ValueError, TypeError):
        return 48


async def get_allow_self_approval_global() -> bool:
    config = await _get_workflow_config()
    return bool(config.get("allow_self_approval_global", False))


async def get_workflow_config_row() -> dict:
    """Gibt den kompletten Config-Row zurück (für GET /api/admin/approval-workflow)."""
    return await _get_workflow_config()


async def update_workflow_config(
    default_approver_group_id: int | None = None,
    default_expiration_hours: int | None = None,
    allow_self_approval_global: bool | None = None,
    actor_user_id: int | None = None,
) -> None:
    """Aktualisiert optionale Felder in approval_workflow_config (id=1)."""
    if all(v is None for v in (default_approver_group_id, default_expiration_hours, allow_self_approval_global)):
        return
    now = _now()
    set_parts = ["updated_at = :now", "updated_by_user_id = :uid"]
    params: dict = {"now": now, "uid": actor_user_id}
    if default_approver_group_id is not None:
        set_parts.append("default_approver_group_id = :gid")
        params["gid"] = default_approver_group_id
    if default_expiration_hours is not None:
        set_parts.append("default_expiration_hours = :exp")
        params["exp"] = default_expiration_hours
    if allow_self_approval_global is not None:
        set_parts.append("allow_self_approval_global = :sa")
        params["sa"] = 1 if allow_self_approval_global else 0
    sql = f"UPDATE approval_workflow_config SET {', '.join(set_parts)} WHERE id=1"
    async with get_db() as db:
        await db.execute(text(sql), params)
        await db.commit()


async def on_rule_updated_suspend_pending(
    rule_id: int, old: dict, new: dict, actor: str
) -> int:
    """Öffentlicher Protocol-Hook: suspendiert pending Anträge bei Regeländerung."""
    if old.get("action_type") != new.get("action_type") or \
       old.get("action_target") != new.get("action_target"):
        return 0
    await _suspend_pending_for_rule(
        action_type=old["action_type"],
        action_target=old["action_target"],
        old_rule=old,
        new_rule=new,
        actor_username=actor,
    )
    return 1


# ── CRUD ─────────────────────────────────────────────────────────────────────

async def list_rules() -> list[dict]:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT ar.*,
                       (SELECT COUNT(*) FROM pending_approvals pa
                         WHERE pa.action_type = ar.action_type
                           AND pa.action_target = ar.action_target
                           AND pa.status = 'pending') as active_count
                  FROM approval_rules ar
                 ORDER BY ar.action_type, ar.action_target
            """)
        )
        rows = result.mappings().fetchall()
    return [_row_to_dict(dict(r)) for r in rows]


async def get_rule(rule_id: int) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM approval_rules WHERE id = :id"),
            {"id": rule_id},
        )
        row = result.mappings().fetchone()
    return _row_to_dict(dict(row)) if row else None


async def get_rule_for_action(action_type: str, action_target: str) -> dict | None:
    """Gibt die aktive Regel für eine Aktion zurück (ui_override bevorzugt)."""
    async with get_db() as db:
        # UI-Override hat Priorität
        result = await db.execute(
            text("""
                SELECT * FROM approval_rules
                 WHERE action_type = :at AND action_target = :tgt
                   AND is_active = 1
                 ORDER BY CASE source WHEN 'ui_override' THEN 0 ELSE 1 END
                 LIMIT 1
            """),
            {"at": action_type, "tgt": action_target},
        )
        row = result.mappings().fetchone()
    return _row_to_dict(dict(row)) if row else None


async def count_active_required_rules() -> int:
    """Zählt aktive required=true Regeln (für Core-Limit-Check)."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT COUNT(*) FROM approval_rules WHERE is_active=1 AND required=1")
        )
        return result.scalar() or 0


async def create_rule(
    action_type: str,
    action_target: str,
    required: bool,
    approver_groups: list[int],
    approver_users: list[int],
    expiration_hours: int,
    allow_self_approval: bool,
    source: str,
    actor_user_id: int | None,
    actor_username: str,
    meta_yaml_snapshot: dict | None = None,
    is_active: bool = True,
) -> dict:
    """Legt eine neue Approval-Regel an. Prüft Core-Limit."""
    if action_type not in VALID_ACTION_TYPES:
        raise ValueError(f"Ungültiger action_type: {action_type}")

    # Core-Limit-Check
    if required and is_active:
        max_rules = plus_behavior.get_max_approval_rules()
        if max_rules is not None:
            current = await count_active_required_rules()
            if current >= max_rules:
                raise ValueError("core_limit_3_approval_rules")

    # Self-Approval normalisieren
    if not plus_behavior.allow_self_approval_supported():
        allow_self_approval = False

    now = _now()
    async with get_db() as db:
        try:
            await db.execute(
                text("""
                    INSERT INTO approval_rules
                        (action_type, action_target, required, approver_groups, approver_users,
                         expiration_hours, allow_self_approval, source, is_active,
                         meta_yaml_snapshot, created_at, updated_at, updated_by_user_id)
                    VALUES (:at, :tgt, :req, :ag, :au, :exp, :sa, :src, :active,
                            :snapshot, :now, :now, :uid)
                """),
                {
                    "at": action_type, "tgt": action_target,
                    "req": 1 if required else 0,
                    "ag": json.dumps(approver_groups),
                    "au": json.dumps(approver_users),
                    "exp": expiration_hours,
                    "sa": 1 if allow_self_approval else 0,
                    "src": source,
                    "active": 1 if is_active else 0,
                    "snapshot": json.dumps(meta_yaml_snapshot) if meta_yaml_snapshot else None,
                    "now": now,
                    "uid": actor_user_id,
                },
            )
            await db.commit()
            result = await db.execute(
                text("SELECT * FROM approval_rules WHERE action_type=:at AND action_target=:tgt"),
                {"at": action_type, "tgt": action_target},
            )
            row = result.mappings().fetchone()
        except IntegrityError:
            raise ValueError("approval_rule_already_exists")

    rule = _row_to_dict(dict(row))
    await write_audit_log(
        "approval_rule_changed", actor_username, "local",
        detail=json.dumps({
            "rule_id": rule["id"], "action_type": action_type, "action_target": action_target,
            "old_rule": None, "new_rule": rule, "source": source,
        })
    )
    return rule


async def update_rule(
    rule_id: int,
    updates: dict,
    actor_user_id: int | None,
    actor_username: str,
) -> dict:
    """Aktualisiert eine Approval-Regel. Triggert Suspended-Workflow bei signifikanten Änderungen."""
    old_rule = await get_rule(rule_id)
    if old_rule is None:
        raise ValueError("rule_not_found")

    # Self-Approval normalisieren
    if "allow_self_approval" in updates and not plus_behavior.allow_self_approval_supported():
        updates["allow_self_approval"] = False

    # Core-Limit-Check bei require=true Aktivierung
    new_required = updates.get("required", old_rule["required"])
    new_is_active = updates.get("is_active", old_rule["is_active"])
    if new_required and new_is_active:
        if not (old_rule["required"] and old_rule["is_active"]):
            max_rules = plus_behavior.get_max_approval_rules()
            if max_rules is not None:
                current = await count_active_required_rules()
                if current >= max_rules:
                    raise ValueError("core_limit_3_approval_rules")

    now = _now()
    set_parts = []
    params: dict = {"id": rule_id, "now": now, "uid": actor_user_id}

    field_map = {
        "required": ("required", lambda v: 1 if v else 0),
        "approver_groups": ("approver_groups", json.dumps),
        "approver_users": ("approver_users", json.dumps),
        "expiration_hours": ("expiration_hours", int),
        "allow_self_approval": ("allow_self_approval", lambda v: 1 if v else 0),
        "is_active": ("is_active", lambda v: 1 if v else 0),
        "source": ("source", str),
        "meta_yaml_snapshot": ("meta_yaml_snapshot", lambda v: json.dumps(v) if v else None),
    }

    for key, (col, transform) in field_map.items():
        if key in updates and updates[key] is not None:
            set_parts.append(f"{col} = :{col}")
            params[col] = transform(updates[key])

    if not set_parts:
        return old_rule

    set_parts.extend(["updated_at = :now", "updated_by_user_id = :uid"])
    sql = f"UPDATE approval_rules SET {', '.join(set_parts)} WHERE id = :id"

    async with get_db() as db:
        await db.execute(text(sql), params)
        await db.commit()

    new_rule = await get_rule(rule_id)
    assert new_rule is not None

    # Audit
    await write_audit_log(
        "approval_rule_changed", actor_username, "local",
        detail=json.dumps({
            "rule_id": rule_id,
            "action_type": old_rule["action_type"],
            "action_target": old_rule["action_target"],
            "old_rule": old_rule,
            "new_rule": new_rule,
            "source": new_rule["source"],
        })
    )

    # Suspended-Workflow bei signifikanten Änderungen
    significant_fields = {"required", "approver_groups", "approver_users", "allow_self_approval"}
    if significant_fields & set(updates.keys()):
        await _suspend_pending_for_rule(
            action_type=old_rule["action_type"],
            action_target=old_rule["action_target"],
            old_rule=old_rule,
            new_rule=new_rule,
            actor_username=actor_username,
        )

    return new_rule


async def delete_rule(rule_id: int, actor_user_id: int | None, actor_username: str) -> None:
    """Löscht eine UI-Override-Regel. meta_yaml-Regeln können nicht gelöscht werden."""
    rule = await get_rule(rule_id)
    if rule is None:
        raise ValueError("rule_not_found")
    if rule["source"] == "meta_yaml":
        raise ValueError("cannot_delete_meta_yaml_rule")

    async with get_db() as db:
        await db.execute(text("DELETE FROM approval_rules WHERE id = :id"), {"id": rule_id})
        await db.commit()

    await write_audit_log(
        "approval_rule_changed", actor_username, "local",
        detail=json.dumps({
            "rule_id": rule_id, "action": "deleted",
            "action_type": rule["action_type"], "action_target": rule["action_target"],
        })
    )


async def _suspend_pending_for_rule(
    action_type: str,
    action_target: str,
    old_rule: dict,
    new_rule: dict,
    actor_username: str,
) -> None:
    """Setzt alle pending Anträge dieser Aktion auf suspended."""
    now = _now()
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id FROM pending_approvals
                 WHERE action_type=:at AND action_target=:tgt AND status='pending'
            """),
            {"at": action_type, "tgt": action_target},
        )
        ids = [r[0] for r in result.fetchall()]

        if ids:
            await db.execute(
                text("""
                    UPDATE pending_approvals
                       SET status='suspended', decided_at=:now,
                           decided_reason='rule_changed'
                     WHERE action_type=:at AND action_target=:tgt AND status='pending'
                """),
                {"now": now, "at": action_type, "tgt": action_target},
            )

        # Aktive Schedules dieser Aktion in Plus-Tabelle suspendieren
        await db.execute(
            text("""
                INSERT OR IGNORE INTO scheduled_job_approval_status
                    (scheduled_job_id, status, reason, updated_at)
                SELECT sj.id, 'suspended', 'rule_changed', :now
                  FROM scheduled_jobs sj
                 WHERE sj.active = 1
                   AND json_extract(sj.config, '$.action_type') = :at
                   AND json_extract(sj.config, '$.action_target') = :tgt
                   AND NOT EXISTS (
                       SELECT 1 FROM scheduled_job_approval_status
                        WHERE scheduled_job_id = sj.id
                   )
            """),
            {"at": action_type, "tgt": action_target, "now": now},
        )
        await db.commit()

    for approval_id in ids:
        await write_audit_log(
            "approval_suspended", actor_username, "local",
            detail=json.dumps({
                "approval_id": approval_id,
                "old_rule_snapshot": old_rule,
                "new_rule_snapshot": new_rule,
            })
        )


# ── Discovery-Sync (meta.yaml Integration) ────────────────────────────────────

async def sync_meta_yaml_rule(
    action_type: str,
    action_target: str,
    approval_block: dict,
    actor_username: str = "system",
) -> None:
    """Wird beim Playbook/Packer-Discovery aufgerufen wenn meta.yaml einen approval:-Block hat."""
    required = bool(approval_block.get("required", False))
    expiration_hours = int(approval_block.get("expiration_hours", 48))
    allow_self_approval = bool(approval_block.get("allow_self_approval", False))
    approver_group_names: list[str] = approval_block.get("approver_groups", [])
    approver_user_names: list[str] = approval_block.get("approver_users", [])

    # Gruppen und User via Name auflösen
    approver_groups = await _resolve_group_ids(approver_group_names)
    approver_users = await _resolve_user_ids(approver_user_names)

    now = _now()
    async with get_db() as db:
        # Prüfe ob UI-Override existiert
        result = await db.execute(
            text("""
                SELECT id, source FROM approval_rules
                 WHERE action_type=:at AND action_target=:tgt
            """),
            {"at": action_type, "tgt": action_target},
        )
        existing = result.mappings().fetchone()

        snapshot = {
            "required": required,
            "approver_groups": approver_groups,
            "approver_users": approver_users,
            "expiration_hours": expiration_hours,
            "allow_self_approval": allow_self_approval,
        }

        if existing is None:
            # Neue meta_yaml-Regel anlegen
            await db.execute(
                text("""
                    INSERT INTO approval_rules
                        (action_type, action_target, required, approver_groups, approver_users,
                         expiration_hours, allow_self_approval, source, is_active,
                         meta_yaml_snapshot, created_at, updated_at, updated_by_user_id)
                    VALUES (:at, :tgt, :req, :ag, :au, :exp, :sa, 'meta_yaml', 1,
                            :snapshot, :now, :now, NULL)
                    ON CONFLICT(action_type, action_target) DO NOTHING
                """),
                {
                    "at": action_type, "tgt": action_target,
                    "req": 1 if required else 0,
                    "ag": json.dumps(approver_groups),
                    "au": json.dumps(approver_users),
                    "exp": expiration_hours,
                    "sa": 1 if allow_self_approval else 0,
                    "snapshot": json.dumps(snapshot),
                    "now": now,
                },
            )
        elif existing["source"] == "meta_yaml":
            # Bestehende meta_yaml-Regel updaten
            await db.execute(
                text("""
                    UPDATE approval_rules
                       SET required=:req, approver_groups=:ag, approver_users=:au,
                           expiration_hours=:exp, allow_self_approval=:sa,
                           meta_yaml_snapshot=:snapshot, updated_at=:now
                     WHERE action_type=:at AND action_target=:tgt AND source='meta_yaml'
                """),
                {
                    "req": 1 if required else 0,
                    "ag": json.dumps(approver_groups),
                    "au": json.dumps(approver_users),
                    "exp": expiration_hours,
                    "sa": 1 if allow_self_approval else 0,
                    "snapshot": json.dumps(snapshot),
                    "now": now,
                    "at": action_type, "tgt": action_target,
                },
            )
        else:
            # UI-Override existiert: nur meta_yaml_snapshot aktualisieren (für Konflikt-Badge)
            await db.execute(
                text("""
                    UPDATE approval_rules
                       SET meta_yaml_snapshot=:snapshot, updated_at=:now
                     WHERE action_type=:at AND action_target=:tgt AND source='ui_override'
                """),
                {"snapshot": json.dumps(snapshot), "now": now,
                 "at": action_type, "tgt": action_target},
            )
        await db.commit()


async def remove_meta_yaml_rule(action_type: str, action_target: str) -> None:
    """Löscht eine meta_yaml-Regel wenn der approval:-Block aus meta.yaml entfernt wurde."""
    async with get_db() as db:
        await db.execute(
            text("""
                DELETE FROM approval_rules
                 WHERE action_type=:at AND action_target=:tgt AND source='meta_yaml'
            """),
            {"at": action_type, "tgt": action_target},
        )
        await db.commit()


async def _resolve_group_ids(group_names: list[str]) -> list[int]:
    if not group_names:
        return []
    async with get_db() as db:
        result = await db.execute(
            text(f"""
                SELECT id FROM groups
                 WHERE name IN ({','.join(f':n{i}' for i in range(len(group_names)))})
            """),
            {f"n{i}": n for i, n in enumerate(group_names)},
        )
        return [r[0] for r in result.fetchall()]


async def _resolve_user_ids(usernames: list[str]) -> list[int]:
    if not usernames:
        return []
    async with get_db() as db:
        result = await db.execute(
            text(f"""
                SELECT id FROM local_users
                 WHERE username IN ({','.join(f':u{i}' for i in range(len(usernames)))})
            """),
            {f"u{i}": u for i, u in enumerate(usernames)},
        )
        return [r[0] for r in result.fetchall()]
