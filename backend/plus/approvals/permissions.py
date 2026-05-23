# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Approver-Berechtigungsprüfung für den Approval-Workflow.

can_user_approve() implementiert die 5-Stufen-Routing-Logik aus der Spec:
  1. Admin-Override (manage_users) → immer true
  2. User in approver_users der Regel → true
  3. User in approver_groups (via PROJ-45 group_members) → true
  4. default_approver_group_id Fallback → true
  5. sonst false
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

from backend.db.database import get_db

logger = logging.getLogger(__name__)


async def can_user_approve(
    user_id: int,
    portal_permissions: list[str],
    rule_snapshot: dict,
) -> bool:
    """Prüft ob der User diesen Antrag genehmigen darf."""
    # Stufe 1: Admin-Override
    if "manage_users" in portal_permissions:
        return True

    # Stufe 2: User in approver_users
    approver_users = rule_snapshot.get("approver_users") or []
    if isinstance(approver_users, str):
        try:
            approver_users = json.loads(approver_users)
        except Exception:
            approver_users = []
    if user_id in approver_users:
        return True

    # Stufe 3: User in einer der approver_groups
    approver_groups = rule_snapshot.get("approver_groups") or []
    if isinstance(approver_groups, str):
        try:
            approver_groups = json.loads(approver_groups)
        except Exception:
            approver_groups = []

    if approver_groups:
        group_ids_sql = ",".join(str(g) for g in approver_groups if isinstance(g, int))
        if group_ids_sql:
            async with get_db() as db:
                result = await db.execute(
                    text(f"""
                        SELECT COUNT(*) FROM group_members
                         WHERE user_id = :uid AND group_id IN ({group_ids_sql})
                    """),
                    {"uid": user_id},
                )
                if (result.scalar() or 0) > 0:
                    return True

    # Stufe 4: default_approver_group_id Fallback
    from backend.plus.approvals.rules_service import get_default_approver_group_id
    default_group_id = await get_default_approver_group_id()
    if default_group_id:
        async with get_db() as db:
            result = await db.execute(
                text("""
                    SELECT COUNT(*) FROM group_members
                     WHERE user_id = :uid AND group_id = :gid
                """),
                {"uid": user_id, "gid": default_group_id},
            )
            if (result.scalar() or 0) > 0:
                return True

    # Stufe 5: approve_jobs-Permission (delegierbare Berechtigung ohne Admin-Status)
    if "approve_jobs" in portal_permissions:
        return True

    return False


async def count_approvable_for_user(user_id: int, username: str) -> int:
    """Zählt pending Anträge die der User entscheiden kann."""
    # Alle pending Anträge holen
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT rule_snapshot, requester_user_id FROM pending_approvals
                 WHERE status='pending'
            """)
        )
        rows = result.fetchall()

    # Portal-Permissions des Users laden
    async with get_db() as db:
        perm_result = await db.execute(
            text("SELECT portal_permissions FROM local_users WHERE id = :uid"),
            {"uid": user_id},
        )
        perm_row = perm_result.fetchone()

    portal_permissions: list[str] = []
    if perm_row and perm_row[0]:
        try:
            portal_permissions = json.loads(perm_row[0])
        except Exception:
            portal_permissions = []

    count = 0
    for row in rows:
        try:
            snapshot = json.loads(row[0]) if isinstance(row[0], str) else (row[0] or {})
        except Exception:
            snapshot = {}
        # Kein Self-Approval check hier – nur ob man prinzipiell darf
        if await can_user_approve(user_id, portal_permissions, snapshot):
            count += 1

    return count
