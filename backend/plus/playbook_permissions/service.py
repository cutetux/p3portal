# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-49/63: Service für Playbook-Whitelist-Permissions (Plus-Modul).

Zuständigkeiten:
- CRUD auf playbook_permissions-Tabelle (Plus-eigene MetaData)
- default_mode aus playbook_permissions_config lesen/schreiben (PROJ-63)
- Bulk-Lookup (alle erlaubten Playbooks für einen User)
- Cleanup-Hooks (User-Delete, Group-Delete, Playbook-Delete, Stale-Cleanup)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.services.audit_service import write_audit_log
from backend.services.playbook_service import list_playbooks

logger = logging.getLogger(__name__)

_DEFAULT_MODE = "open"
_VALID_MODES = {"open", "restricted"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── playbook_permissions_config helpers (PROJ-63) ────────────────────────────

async def get_default_playbook_mode() -> str:
    """Liest default_mode aus playbook_permissions_config (Plus-Tabelle, PROJ-63)."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT default_mode FROM playbook_permissions_config WHERE id = 1")
        )
        row = result.fetchone()
        if row:
            return row[0]
        # Noch nicht migriert oder leere DB → sicherer Fallback
        return _DEFAULT_MODE


async def set_default_playbook_mode(
    mode: str, actor_username: str, actor_user_id: int | None = None
) -> str:
    if mode not in _VALID_MODES:
        raise ValueError(f"Ungültiger Modus: {mode}. Erlaubt: {_VALID_MODES}")
    old_mode = await get_default_playbook_mode()
    if old_mode == mode:
        return mode
    now = _now()
    async with get_db() as db:
        # Upsert auf Single-Row (id=1 erzwingt Single-Row via Constraint)
        await db.execute(
            text(
                "INSERT INTO playbook_permissions_config (id, default_mode, updated_at, updated_by_user_id) "
                "VALUES (1, :mode, :now, :uid) "
                "ON CONFLICT(id) DO UPDATE SET "
                "default_mode=excluded.default_mode, "
                "updated_at=excluded.updated_at, "
                "updated_by_user_id=excluded.updated_by_user_id"
            ),
            {"mode": mode, "now": now, "uid": actor_user_id},
        )
        await db.commit()
    await write_audit_log(
        "default_playbook_mode_changed",
        username=actor_username,
        detail=json.dumps({"old_value": old_mode, "new_value": mode}),
    )
    return mode


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def _subject_label(db, subject_type: str, subject_id: int) -> str:
    if subject_type == "user":
        result = await db.execute(
            text("SELECT username FROM local_users WHERE id = :id"),
            {"id": subject_id},
        )
        row = result.fetchone()
        return row[0] if row else f"user#{subject_id}"
    else:
        result = await db.execute(
            text("SELECT name FROM groups WHERE id = :id"),
            {"id": subject_id},
        )
        row = result.fetchone()
        return row[0] if row else f"group#{subject_id}"


async def _actor_username(db, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    result = await db.execute(
        text("SELECT username FROM local_users WHERE id = :id"),
        {"id": user_id},
    )
    row = result.fetchone()
    return row[0] if row else None


async def _row_to_dict(db, row) -> dict:
    subject_label = await _subject_label(db, row["subject_type"], row["subject_id"])
    added_by_username = await _actor_username(db, row["added_by_user_id"])
    return {
        "id": row["id"],
        "playbook_name": row["playbook_name"],
        "subject_type": row["subject_type"],
        "subject_id": row["subject_id"],
        "subject_label": subject_label,
        "added_at": row["added_at"],
        "added_by_user_id": row["added_by_user_id"],
        "added_by_username": added_by_username,
    }


async def list_permissions(playbook_name: str) -> list[dict]:
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, playbook_name, subject_type, subject_id, added_at, added_by_user_id "
                "FROM playbook_permissions WHERE playbook_name = :name ORDER BY added_at"
            ),
            {"name": playbook_name},
        )
        rows = result.mappings().fetchall()
        return [await _row_to_dict(db, r) for r in rows]


async def add_permission(
    playbook_name: str,
    subject_type: str,
    subject_id: int,
    actor_user_id: int,
    actor_username: str,
) -> dict:
    if subject_type not in ("user", "group"):
        raise ValueError("subject_type muss 'user' oder 'group' sein")

    # Validate subject existence
    async with get_db() as db:
        if subject_type == "user":
            r = await db.execute(
                text("SELECT id FROM local_users WHERE id = :id"),
                {"id": subject_id},
            )
            if not r.fetchone():
                raise KeyError(f"Nutzer {subject_id} nicht gefunden")
        else:
            r = await db.execute(
                text("SELECT id FROM groups WHERE id = :id"),
                {"id": subject_id},
            )
            if not r.fetchone():
                raise KeyError(f"Gruppe {subject_id} nicht gefunden")

        now = _now()
        try:
            result = await db.execute(
                text(
                    "INSERT INTO playbook_permissions "
                    "(playbook_name, subject_type, subject_id, added_at, added_by_user_id) "
                    "VALUES (:name, :st, :sid, :now, :actor) RETURNING id"
                ),
                {
                    "name": playbook_name,
                    "st": subject_type,
                    "sid": subject_id,
                    "now": now,
                    "actor": actor_user_id,
                },
            )
            new_id = result.fetchone()[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("playbook_permission_duplicate")

        row = (await db.execute(
            text("SELECT id, playbook_name, subject_type, subject_id, added_at, added_by_user_id "
                 "FROM playbook_permissions WHERE id = :id"),
            {"id": new_id},
        )).mappings().fetchone()
        entry = await _row_to_dict(db, row)

    subject_label = entry["subject_label"]
    await write_audit_log(
        "playbook_permission_added",
        username=actor_username,
        detail=json.dumps({
            "playbook_name": playbook_name,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_label": subject_label,
        }),
    )
    return entry


async def remove_permission(
    permission_id: int,
    actor_username: str,
) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT id, playbook_name, subject_type, subject_id FROM playbook_permissions WHERE id = :id"),
            {"id": permission_id},
        )
        row = result.mappings().fetchone()
        if not row:
            return False
        playbook_name = row["playbook_name"]
        subject_type = row["subject_type"]
        subject_id = row["subject_id"]
        subject_label = await _subject_label(db, subject_type, subject_id)
        await db.execute(
            text("DELETE FROM playbook_permissions WHERE id = :id"),
            {"id": permission_id},
        )
        await db.commit()

    await write_audit_log(
        "playbook_permission_removed",
        username=actor_username,
        detail=json.dumps({
            "playbook_name": playbook_name,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_label": subject_label,
        }),
    )
    return True


# ── Bulk-Lookup: Welche Playbooks darf ein User ausführen? ────────────────────

async def get_allowed_playbooks_for_user(user_id: int) -> list[dict]:
    """Gibt alle Playbooks zurück, die user_id ausführen darf, mit Source-Info.

    Wird von GET /api/me/playbook-permissions verwendet.
    """
    from backend.services.permissions_resolver import _is_admin, _get_group_ids

    all_playbooks = list_playbooks()
    default_mode = await get_default_playbook_mode()

    async with get_db() as db:
        if await _is_admin(db, user_id):
            return [
                {
                    "playbook_name": pb.id,
                    "category": pb.category,
                    "source": "admin",
                }
                for pb in all_playbooks
            ]

        group_ids = await _get_group_ids(db, user_id)

        # Alle Whitelist-Einträge des Users (direkt + via Gruppen) in einem Query
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

    whitelisted: dict[str, str] = {}  # playbook_name → source string
    for r in rows:
        name = r["playbook_name"]
        if name not in whitelisted:
            if r["subject_type"] == "user":
                whitelisted[name] = "direct"
            else:
                group_name = r["group_name"] or f"group#{r['subject_id']}"
                whitelisted[name] = f"group:{group_name}"

    allowed: list[dict] = []
    for pb in all_playbooks:
        if pb.id in whitelisted:
            allowed.append({
                "playbook_name": pb.id,
                "category": pb.category,
                "source": whitelisted[pb.id],
            })
        elif default_mode == "open":
            allowed.append({
                "playbook_name": pb.id,
                "category": pb.category,
                "source": "default_mode_open",
            })
    return allowed


# ── Whitelist-Existenz-Check (für Resolver-Funktion) ─────────────────────────

async def has_whitelist_entry_for_user(
    db, playbook_name: str, user_id: int, group_ids: list[int]
) -> bool:
    """Prüft ob user_id (direkt oder via Gruppen) in der Whitelist steht."""
    group_clause = ""
    params: dict = {"name": playbook_name, "uid": user_id}
    if group_ids:
        group_clause = (
            f" OR (subject_type='group' AND subject_id IN "
            f"({','.join(str(g) for g in group_ids)}))"
        )
    result = await db.execute(
        text(
            "SELECT 1 FROM playbook_permissions "
            f"WHERE playbook_name=:name AND ((subject_type='user' AND subject_id=:uid){group_clause}) "
            "LIMIT 1"
        ),
        params,
    )
    return result.fetchone() is not None


async def playbook_has_any_whitelist_entry(db, playbook_name: str) -> bool:
    """True wenn mindestens ein Whitelist-Eintrag für dieses Playbook existiert."""
    result = await db.execute(
        text("SELECT 1 FROM playbook_permissions WHERE playbook_name=:name LIMIT 1"),
        {"name": playbook_name},
    )
    return result.fetchone() is not None


# ── Cleanup-Hooks ─────────────────────────────────────────────────────────────

async def on_user_delete(user_id: int, actor_username: str) -> None:
    """PROJ-49 Hook: alle Whitelist-Einträge eines gelöschten Users entfernen."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, playbook_name FROM playbook_permissions "
                "WHERE subject_type='user' AND subject_id=:uid"
            ),
            {"uid": user_id},
        )
        rows = result.mappings().fetchall()
        if not rows:
            return
        await db.execute(
            text("DELETE FROM playbook_permissions WHERE subject_type='user' AND subject_id=:uid"),
            {"uid": user_id},
        )
        await db.commit()

    for row in rows:
        await write_audit_log(
            "playbook_permission_removed",
            username=actor_username,
            detail=json.dumps({
                "playbook_name": row["playbook_name"],
                "subject_type": "user",
                "subject_id": user_id,
                "reason": "user_deleted",
            }),
        )


async def on_group_delete(group_id: int, actor_username: str) -> None:
    """PROJ-49 Hook: alle Whitelist-Einträge einer gelöschten Gruppe entfernen."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, playbook_name FROM playbook_permissions "
                "WHERE subject_type='group' AND subject_id=:gid"
            ),
            {"gid": group_id},
        )
        rows = result.mappings().fetchall()
        if not rows:
            return
        await db.execute(
            text("DELETE FROM playbook_permissions WHERE subject_type='group' AND subject_id=:gid"),
            {"gid": group_id},
        )
        await db.commit()

    for row in rows:
        await write_audit_log(
            "playbook_permission_removed",
            username=actor_username,
            detail=json.dumps({
                "playbook_name": row["playbook_name"],
                "subject_type": "group",
                "subject_id": group_id,
                "reason": "group_deleted",
            }),
        )


async def on_playbook_delete(playbook_name: str, actor_username: str) -> None:
    """PROJ-49 Hook: alle Whitelist-Einträge eines gelöschten Playbooks entfernen."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, subject_type, subject_id FROM playbook_permissions "
                "WHERE playbook_name=:name"
            ),
            {"name": playbook_name},
        )
        rows = result.mappings().fetchall()
        if not rows:
            return
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
            "count": len(rows),
            "reason": "playbook_deleted",
        }),
    )


async def cleanup_stale_permissions(actor_username: str = "system") -> int:
    """Entfernt Whitelist-Einträge für Playbooks, die nicht mehr existieren.

    Wird beim Service-Start + Volume-Rescan aufgerufen.
    Gibt die Anzahl entfernter Einträge zurück.
    """
    known_names = {pb.id for pb in list_playbooks()}

    async with get_db() as db:
        result = await db.execute(
            text("SELECT DISTINCT playbook_name FROM playbook_permissions")
        )
        db_names = {row[0] for row in result.fetchall()}
        stale_names = db_names - known_names

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
                username=actor_username,
                detail=json.dumps({
                    "playbook_name": name,
                    "count": count,
                    "reason": "playbook_missing",
                }),
            )
        await db.commit()

    logger.info("PROJ-49 Stale-Cleanup: %d Einträge für %d Playbooks entfernt", total, len(stale_names))
    return total
