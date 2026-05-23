# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-63: Playbook-Permission-Plus-Mixin.

Implementiert alle 9 Playbook-Permission-Hooks für die Plus-Edition.
Core-Imports (get_db, audit_service) sind erlaubt – sie sind infrastrukturell,
keine Feature-Module. Import-Richtung: Plus → Core (OK), Core → Plus (verboten).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from backend.core.plus_protocol import AllowedPlaybookEntry, PlaybookPermissionDecision
from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PlaybookPermissionsPlusBehavior:
    """Mixin: Playbook-Whitelist-Berechtigungen für Plus-Edition (PROJ-63)."""

    # ── Gate ─────────────────────────────────────────────────────────────────

    def can_use_playbook_permissions(self) -> bool:
        return True

    # ── Decision-Hooks ────────────────────────────────────────────────────────

    async def can_user_execute_playbook(
        self, user_id: int, playbook_name: str
    ) -> PlaybookPermissionDecision:
        """Single-Resolver: ALLOW / DENY / FALLBACK für eine Playbook+User-Kombination.

        Prüfreihenfolge (§C Tech-Design):
        1. Whitelist-Eintrag (direkt oder via Gruppe) → ALLOW
        2. Whitelist hat Einträge, User nicht drin → DENY
        3. default_mode=restricted, keine Whitelist → DENY
        4. default_mode=open, keine Whitelist → FALLBACK (required_role im Core)
        """
        from backend.services.permissions_resolver import _get_group_ids

        async with get_db() as db:
            group_ids = await _get_group_ids(db, user_id)

            # Whitelist-Eintrag direkt oder via Gruppe?
            group_clause = ""
            params: dict = {"name": playbook_name, "uid": user_id}
            if group_ids:
                group_clause = (
                    f" OR (subject_type='group' AND subject_id IN "
                    f"({','.join(str(g) for g in group_ids)}))"
                )
            hit = await db.execute(
                text(
                    "SELECT 1 FROM playbook_permissions "
                    f"WHERE playbook_name=:name AND ((subject_type='user' AND subject_id=:uid){group_clause}) "
                    "LIMIT 1"
                ),
                params,
            )
            if hit.fetchone() is not None:
                return PlaybookPermissionDecision.ALLOW

            # Existiert überhaupt ein Whitelist-Eintrag für dieses Playbook?
            any_entry = await db.execute(
                text("SELECT 1 FROM playbook_permissions WHERE playbook_name=:name LIMIT 1"),
                {"name": playbook_name},
            )
            if any_entry.fetchone() is not None:
                return PlaybookPermissionDecision.DENY

        # Kein Whitelist-Eintrag → default_mode entscheidet
        from backend.plus.playbook_permissions.service import get_default_playbook_mode
        mode = await get_default_playbook_mode()
        if mode == "restricted":
            return PlaybookPermissionDecision.DENY
        # mode == "open" → FALLBACK: required_role-Prüfung im Resolver
        return PlaybookPermissionDecision.FALLBACK

    async def get_playbook_can_execute_map(
        self, user_id: int, playbook_names: list[str]
    ) -> dict[str, PlaybookPermissionDecision]:
        """Bulk-Resolver für GET /api/playbooks: 1 SQL-Bulk-Query statt N+1.

        Liest:
        1. Default-Mode aus playbook_permissions_config
        2. Alle Whitelist-Einträge für user_id (direkt + Gruppen) in einem JOIN
        3. Welche Playbooks überhaupt Whitelist-Einträge haben

        Gibt pro Playbook-Name ALLOW / DENY / FALLBACK zurück.
        """
        if not playbook_names:
            return {}

        from backend.services.permissions_resolver import _get_group_ids
        from backend.plus.playbook_permissions.service import get_default_playbook_mode

        async with get_db() as db:
            group_ids = await _get_group_ids(db, user_id)

        default_mode = await get_default_playbook_mode()

        async with get_db() as db:
            # Whitelist-Einträge für user direkt
            user_rows = await db.execute(
                text(
                    "SELECT DISTINCT playbook_name FROM playbook_permissions "
                    "WHERE subject_type='user' AND subject_id=:uid"
                ),
                {"uid": user_id},
            )
            user_allowed: set[str] = {r[0] for r in user_rows.fetchall()}

            # Whitelist-Einträge via Gruppen
            group_allowed: set[str] = set()
            if group_ids:
                grp_rows = await db.execute(
                    text(
                        f"SELECT DISTINCT playbook_name FROM playbook_permissions "
                        f"WHERE subject_type='group' AND subject_id IN "
                        f"({','.join(str(g) for g in group_ids)})"
                    ),
                )
                group_allowed = {r[0] for r in grp_rows.fetchall()}

            # Welche Playbooks haben überhaupt einen Whitelist-Eintrag?
            any_rows = await db.execute(
                text("SELECT DISTINCT playbook_name FROM playbook_permissions")
            )
            has_any_entry: set[str] = {r[0] for r in any_rows.fetchall()}

        result: dict[str, PlaybookPermissionDecision] = {}
        for name in playbook_names:
            if name in user_allowed or name in group_allowed:
                result[name] = PlaybookPermissionDecision.ALLOW
            elif name in has_any_entry:
                result[name] = PlaybookPermissionDecision.DENY
            elif default_mode == "restricted":
                result[name] = PlaybookPermissionDecision.DENY
            else:
                result[name] = PlaybookPermissionDecision.FALLBACK
        return result

    async def get_my_allowed_playbooks(
        self, user_id: int
    ) -> list[AllowedPlaybookEntry]:
        """Gibt alle Playbooks zurück, die user_id ausführen darf (für Profil-Sektion)."""
        from backend.services.playbook_service import list_playbooks
        from backend.services.permissions_resolver import _is_admin, _get_group_ids
        from backend.plus.playbook_permissions.service import get_default_playbook_mode

        all_playbooks = list_playbooks()
        default_mode = await get_default_playbook_mode()

        async with get_db() as db:
            if await _is_admin(db, user_id):
                return [
                    AllowedPlaybookEntry(
                        playbook_name=pb.id,
                        category=pb.category,
                        source="admin",
                    )
                    for pb in all_playbooks
                ]

            group_ids = await _get_group_ids(db, user_id)

            group_clause = ""
            params: dict = {"uid": user_id}
            if group_ids:
                group_clause = (
                    f" OR (subject_type='group' AND subject_id IN "
                    f"({','.join(str(g) for g in group_ids)}))"
                )
            result = await db.execute(
                text(
                    "SELECT DISTINCT pp.playbook_name, pp.subject_type, pp.subject_id, g.name as group_name "
                    "FROM playbook_permissions pp "
                    "LEFT JOIN groups g ON pp.subject_type='group' AND g.id=pp.subject_id "
                    f"WHERE (pp.subject_type='user' AND pp.subject_id=:uid){group_clause}"
                ),
                params,
            )
            rows = result.mappings().fetchall()

        whitelisted: dict[str, tuple[str, str | None]] = {}  # name → (source, group_name)
        for r in rows:
            name = r["playbook_name"]
            if name not in whitelisted:
                if r["subject_type"] == "user":
                    whitelisted[name] = ("direct", None)
                else:
                    whitelisted[name] = ("group", r["group_name"] or f"group#{r['subject_id']}")

        allowed: list[AllowedPlaybookEntry] = []
        for pb in all_playbooks:
            if pb.id in whitelisted:
                src, grp = whitelisted[pb.id]
                allowed.append(AllowedPlaybookEntry(
                    playbook_name=pb.id,
                    category=pb.category,
                    source=src,
                    group_name=grp,
                ))
            elif default_mode == "open":
                allowed.append(AllowedPlaybookEntry(
                    playbook_name=pb.id,
                    category=pb.category,
                    source="default_mode_open",
                ))
        return allowed

    # ── Cleanup-Hooks ─────────────────────────────────────────────────────────

    async def on_user_deleted_playbook_permissions(
        self, user_id: int, actor_username: str
    ) -> int:
        """Entfernt alle Whitelist-Einträge für einen gelöschten User. 1 Summary-Audit-Event."""
        async with get_db() as db:
            count_result = await db.execute(
                text(
                    "SELECT COUNT(*) FROM playbook_permissions "
                    "WHERE subject_type='user' AND subject_id=:uid"
                ),
                {"uid": user_id},
            )
            count = count_result.scalar() or 0
            if count == 0:
                return 0
            await db.execute(
                text("DELETE FROM playbook_permissions WHERE subject_type='user' AND subject_id=:uid"),
                {"uid": user_id},
            )
            await db.commit()

        await write_audit_log(
            "playbook_permission_removed_bulk",
            username=actor_username,
            detail=json.dumps({
                "subject_type": "user",
                "subject_id": user_id,
                "count": count,
                "reason": "user_deleted",
            }),
        )
        logger.info("PROJ-63: %d Playbook-Permissions für User %d entfernt", count, user_id)
        return count

    async def on_group_deleted_playbook_permissions(
        self, group_id: int, actor_username: str
    ) -> int:
        """Entfernt alle Whitelist-Einträge für eine gelöschte Gruppe."""
        async with get_db() as db:
            count_result = await db.execute(
                text(
                    "SELECT COUNT(*) FROM playbook_permissions "
                    "WHERE subject_type='group' AND subject_id=:gid"
                ),
                {"gid": group_id},
            )
            count = count_result.scalar() or 0
            if count == 0:
                return 0
            await db.execute(
                text("DELETE FROM playbook_permissions WHERE subject_type='group' AND subject_id=:gid"),
                {"gid": group_id},
            )
            await db.commit()

        await write_audit_log(
            "playbook_permission_removed_bulk",
            username=actor_username,
            detail=json.dumps({
                "subject_type": "group",
                "subject_id": group_id,
                "count": count,
                "reason": "group_deleted",
            }),
        )
        logger.info("PROJ-63: %d Playbook-Permissions für Group %d entfernt", count, group_id)
        return count

    async def on_playbook_deleted_playbook_permissions(
        self, playbook_name: str, actor_username: str
    ) -> int:
        """Entfernt alle Whitelist-Einträge für ein gelöschtes Playbook."""
        async with get_db() as db:
            count_result = await db.execute(
                text("SELECT COUNT(*) FROM playbook_permissions WHERE playbook_name=:name"),
                {"name": playbook_name},
            )
            count = count_result.scalar() or 0
            if count == 0:
                return 0
            await db.execute(
                text("DELETE FROM playbook_permissions WHERE playbook_name=:name"),
                {"name": playbook_name},
            )
            await db.commit()

        await write_audit_log(
            "playbook_permission_auto_removed",
            username=actor_username,
            detail=json.dumps({
                "playbook_name": playbook_name,
                "count": count,
                "reason": "playbook_deleted",
            }),
        )
        return count

    async def cleanup_stale_playbook_permissions(
        self, known_playbooks: set[str]
    ) -> int:
        """Entfernt Whitelist-Einträge für Playbooks, die nicht mehr existieren."""
        async with get_db() as db:
            result = await db.execute(
                text("SELECT DISTINCT playbook_name FROM playbook_permissions")
            )
            db_names = {row[0] for row in result.fetchall()}
            stale_names = db_names - known_playbooks

            if not stale_names:
                return 0

            total = 0
            for name in stale_names:
                count_result = await db.execute(
                    text("SELECT COUNT(*) FROM playbook_permissions WHERE playbook_name=:name"),
                    {"name": name},
                )
                count = count_result.scalar() or 0
                await db.execute(
                    text("DELETE FROM playbook_permissions WHERE playbook_name=:name"),
                    {"name": name},
                )
                total += count
                await write_audit_log(
                    "playbook_permission_auto_removed",
                    username="system",
                    detail=json.dumps({
                        "playbook_name": name,
                        "count": count,
                        "reason": "playbook_missing",
                    }),
                )
            await db.commit()

        logger.info(
            "PROJ-63 Stale-Cleanup: %d Einträge für %d Playbooks entfernt",
            total, len(stale_names),
        )
        return total
