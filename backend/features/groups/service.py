# p3portal.org
"""PROJ-45: Business-Logik für das Groups-Modul."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log

# Cached at startup: True once PROJ-50 pending_approvals table exists.
_approval_available: bool | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def count_groups() -> int:
    """Return total number of groups (used by license/status endpoint)."""
    async with get_db() as db:
        result = await db.execute(text("SELECT COUNT(*) FROM groups"))
        return result.scalar() or 0


async def _approval_workflow_available() -> bool:
    """Returns True when PROJ-50's pending_approvals table exists."""
    global _approval_available
    if _approval_available is None:
        async with get_db() as db:
            try:
                await db.execute(text("SELECT 1 FROM pending_approvals LIMIT 1"))
                _approval_available = True
            except Exception:
                _approval_available = False
    return _approval_available


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_owner_username(db, owner_user_id: int | None) -> str | None:
    if owner_user_id is None:
        return None
    result = await db.execute(
        text("SELECT username FROM local_users WHERE id = :id"),
        {"id": owner_user_id},
    )
    row = result.fetchone()
    return row[0] if row else None


async def _get_member_count(db, group_id: int) -> int:
    result = await db.execute(
        text("SELECT COUNT(*) FROM group_members WHERE group_id = :gid"),
        {"gid": group_id},
    )
    row = result.fetchone()
    return row[0] if row else 0


def _row_to_group(row, owner_username: str | None, member_count: int) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "tags": json.loads(row["tags"] or "[]"),
        "owner_user_id": row["owner_user_id"],
        "owner_username": owner_username,
        "member_count": member_count,
        "created_at": row["created_at"],
        "created_by": row["created_by"],
    }


async def _group_with_members(db, group_id: int) -> dict | None:
    result = await db.execute(
        text("SELECT * FROM groups WHERE id = :id"),
        {"id": group_id},
    )
    row = result.mappings().fetchone()
    if not row:
        return None
    owner_username = await _get_owner_username(db, row["owner_user_id"])
    member_count = await _get_member_count(db, group_id)
    group = _row_to_group(row, owner_username, member_count)

    members_result = await db.execute(
        text(
            "SELECT gm.id, lu.username, lu.role, gm.added_at, gm.added_by "
            "FROM group_members gm "
            "JOIN local_users lu ON lu.id = gm.user_id "
            "WHERE gm.group_id = :gid "
            "ORDER BY gm.added_at"
        ),
        {"gid": group_id},
    )
    members = [
        {
            "id": m["id"],
            "username": m["username"],
            "role": m["role"],
            "added_at": m["added_at"],
            "added_by": m["added_by"],
        }
        for m in members_result.mappings().fetchall()
    ]
    group["members"] = members
    return group


# ── Group CRUD ────────────────────────────────────────────────────────────────

async def list_groups(
    search: str | None = None,
    no_owner: bool = False,
    tag: str | None = None,
) -> list[dict]:
    async with get_db() as db:
        conditions = []
        params: dict = {}
        if search:
            conditions.append("LOWER(g.name) LIKE :search")
            params["search"] = f"%{search.lower()}%"
        if no_owner:
            conditions.append("g.owner_user_id IS NULL")
        if tag:
            conditions.append("g.tags LIKE :tag")
            params["tag"] = f'%"{tag}"%'
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = (
            f"SELECT g.*, lu.username AS owner_username, "
            f"(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count "
            f"FROM groups g "
            f"LEFT JOIN local_users lu ON lu.id = g.owner_user_id "
            f"{where} ORDER BY g.name"
        )
        result = await db.execute(text(sql), params)
        rows = result.mappings().fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "description": r["description"],
                "tags": json.loads(r["tags"] or "[]"),
                "owner_user_id": r["owner_user_id"],
                "owner_username": r["owner_username"],
                "member_count": r["member_count"],
                "created_at": r["created_at"],
                "created_by": r["created_by"],
            }
            for r in rows
        ]


async def get_group(group_id: int) -> dict | None:
    async with get_db() as db:
        return await _group_with_members(db, group_id)


async def create_group(
    name: str,
    description: str | None,
    tags: list[str],
    owner_user_id: int | None,
    created_by: str,
) -> dict:
    max_groups = plus_behavior.get_max_groups()
    async with get_db() as db:
        if max_groups is not None:
            count_result = await db.execute(text("SELECT COUNT(*) FROM groups"))
            count = count_result.scalar() or 0
            if count >= max_groups:
                raise PermissionError(
                    f"Core-Edition erlaubt maximal {max_groups} Gruppen. "
                    "Bitte auf Plus upgraden oder bestehende Gruppen löschen."
                )

        if owner_user_id is not None:
            owner_check = await db.execute(
                text("SELECT id FROM local_users WHERE id = :id"),
                {"id": owner_user_id},
            )
            owner_row = owner_check.fetchone()
            if not owner_row:
                raise ValueError(f"Nutzer mit ID {owner_user_id} nicht gefunden")

        now = _now()
        try:
            result = await db.execute(
                text(
                    "INSERT INTO groups (name, description, tags, owner_user_id, created_at, created_by) "
                    "VALUES (:name, :desc, :tags, :owner, :now, :by) "
                    "RETURNING id"
                ),
                {
                    "name": name,
                    "desc": description,
                    "tags": json.dumps(tags),
                    "owner": owner_user_id,
                    "now": now,
                    "by": created_by,
                },
            )
            row = result.fetchone()
            group_id = row[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError(f"Eine Gruppe mit dem Namen '{name}' existiert bereits.")

        await write_audit_log(
            "group_created",
            username=created_by,
            detail=json.dumps({"group_id": group_id, "name": name, "created_by": created_by}),
        )
        group = await _group_with_members(db, group_id)
        return group  # type: ignore[return-value]


async def update_group(
    group_id: int,
    name: str | None,
    description: str | None,
    tags: list[str] | None,
    owner_user_id: int | None,
    clear_owner: bool,
    updated_by: str,
) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM groups WHERE id = :id"),
            {"id": group_id},
        )
        row = result.mappings().fetchone()
        if not row:
            return None

        updates: list[str] = []
        params: dict = {"id": group_id}

        if name is not None and name != row["name"]:
            updates.append("name = :name")
            params["name"] = name
            await write_audit_log(
                "group_renamed",
                username=updated_by,
                detail=json.dumps({"group_id": group_id, "old_name": row["name"], "new_name": name}),
            )

        if description is not None and description != row["description"]:
            updates.append("description = :desc")
            params["desc"] = description

        if tags is not None and json.dumps(tags) != row["tags"]:
            updates.append("tags = :tags")
            params["tags"] = json.dumps(tags)

        diff: dict = {}
        if description is not None and description != row["description"]:
            diff["description"] = {"old": row["description"], "new": description}
        if tags is not None and json.dumps(tags) != row["tags"]:
            diff["tags"] = {"old": json.loads(row["tags"] or "[]"), "new": tags}
        if diff:
            await write_audit_log(
                "group_meta_changed",
                username=updated_by,
                detail=json.dumps({"group_id": group_id, "diff": diff}),
            )

        old_owner = row["owner_user_id"]
        new_owner: int | None = old_owner
        if clear_owner:
            new_owner = None
        elif owner_user_id is not None:
            new_owner = owner_user_id

        if new_owner != old_owner:
            if new_owner is not None:
                owner_check = await db.execute(
                    text("SELECT id FROM local_users WHERE id = :id"),
                    {"id": new_owner},
                )
                if not owner_check.fetchone():
                    raise ValueError(f"Nutzer mit ID {new_owner} nicht gefunden")
            updates.append("owner_user_id = :owner")
            params["owner"] = new_owner
            await write_audit_log(
                "group_owner_changed",
                username=updated_by,
                detail=json.dumps({
                    "group_id": group_id,
                    "old_owner_id": old_owner,
                    "new_owner_id": new_owner,
                }),
            )

        if updates:
            try:
                await db.execute(
                    text(f"UPDATE groups SET {', '.join(updates)} WHERE id = :id"),
                    params,
                )
                await db.commit()
            except IntegrityError:
                await db.rollback()
                raise ValueError(f"Eine Gruppe mit dem Namen '{name}' existiert bereits.")

        return await _group_with_members(db, group_id)


async def delete_group(group_id: int, deleted_by: str) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM groups WHERE id = :id"),
            {"id": group_id},
        )
        row = result.mappings().fetchone()
        if not row:
            return False

        count = await _get_member_count(db, group_id)
        await db.execute(text("DELETE FROM groups WHERE id = :id"), {"id": group_id})
        await db.commit()

    # PROJ-63: Whitelist-Einträge für diese Gruppe entfernen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_group_deleted_playbook_permissions(group_id, deleted_by)
    except Exception:
        pass

    # PROJ-62: Pool-Assignments für diese Gruppe entfernen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_group_deleted_pools(group_id, deleted_by)
    except Exception:
        pass

    # PROJ-64: Pending Approvals für diese Gruppe canceln (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_group_deleted_approval_workflow(group_id, deleted_by)
    except Exception:
        pass

    await write_audit_log(
        "group_deleted",
        username=deleted_by,
        detail=json.dumps({
            "group_id": group_id,
            "name": row["name"],
            "members_count": count,
            "assignments_count": 0,
        }),
    )
    return True


# ── Members ───────────────────────────────────────────────────────────────────

async def add_member(group_id: int, user_id: int, added_by: str) -> dict:
    async with get_db() as db:
        group_check = await db.execute(
            text("SELECT id FROM groups WHERE id = :id"),
            {"id": group_id},
        )
        if not group_check.fetchone():
            raise KeyError(f"Gruppe {group_id} nicht gefunden")

        user_result = await db.execute(
            text("SELECT id FROM local_users WHERE id = :id"),
            {"id": user_id},
        )
        user_row = user_result.fetchone()
        if not user_row:
            raise ValueError(
                f"Nutzer mit ID {user_id} nicht gefunden oder kein lokaler Portal-Nutzer. "
                "Nur lokale Portal-Nutzer können Gruppen-Mitglieder sein."
            )

        now = _now()
        try:
            await db.execute(
                text(
                    "INSERT INTO group_members (group_id, user_id, member_kind, added_at, added_by) "
                    "VALUES (:gid, :uid, 'local_user', :now, :by)"
                ),
                {"gid": group_id, "uid": user_id, "now": now, "by": added_by},
            )
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Dieser Nutzer ist bereits Mitglied der Gruppe.")

    await write_audit_log(
        "group_member_added",
        username=added_by,
        detail=json.dumps({
            "group_id": group_id,
            "user_id": user_id,
            "added_by": added_by,
            "source": "manual",
        }),
    )

    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT gm.id, lu.username, lu.role, gm.added_at, gm.added_by "
                "FROM group_members gm JOIN local_users lu ON lu.id = gm.user_id "
                "WHERE gm.group_id = :gid AND gm.user_id = :uid"
            ),
            {"gid": group_id, "uid": user_id},
        )
        row = result.mappings().fetchone()
        return dict(row) if row else {}


async def remove_member(
    group_id: int, user_id: int, removed_by: str, source: str = "manual"
) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("DELETE FROM group_members WHERE group_id = :gid AND user_id = :uid"),
            {"gid": group_id, "uid": user_id},
        )
        await db.commit()
        if result.rowcount == 0:
            return False

    await write_audit_log(
        "group_member_removed",
        username=removed_by,
        detail=json.dumps({
            "group_id": group_id,
            "user_id": user_id,
            "removed_by": removed_by,
            "source": source,
        }),
    )
    return True


# ── User-deletion hooks ───────────────────────────────────────────────────────

async def cleanup_user_from_groups(user_id: int, username: str, deleted_by: str) -> None:
    """Write audit logs for all group memberships and owner assignments before user deletion.

    The actual data cleanup is handled by DB CASCADE (memberships) and
    ON DELETE SET NULL (owner_user_id).
    """
    async with get_db() as db:
        members_result = await db.execute(
            text("SELECT group_id FROM group_members WHERE user_id = :uid"),
            {"uid": user_id},
        )
        member_rows = members_result.fetchall()

        owner_result = await db.execute(
            text("SELECT id, name FROM groups WHERE owner_user_id = :uid"),
            {"uid": user_id},
        )
        owner_rows = owner_result.mappings().fetchall()

    for row in member_rows:
        await write_audit_log(
            "group_member_removed",
            username=deleted_by,
            detail=json.dumps({
                "group_id": row[0],
                "user_id": user_id,
                "removed_by": deleted_by,
                "source": "user_deleted",
            }),
        )

    for row in owner_rows:
        await write_audit_log(
            "group_owner_changed",
            username=deleted_by,
            detail=json.dumps({
                "group_id": row["id"],
                "old_owner_id": user_id,
                "new_owner_id": None,
            }),
        )


# ── Profile helper ────────────────────────────────────────────────────────────

async def get_user_groups(username: str) -> list[dict]:
    """Return group memberships for a user (used in GET /api/me)."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT g.id, g.name, lu.username AS owner_username "
                "FROM group_members gm "
                "JOIN groups g ON g.id = gm.group_id "
                "JOIN local_users u ON u.username = :uname AND u.id = gm.user_id "
                "LEFT JOIN local_users lu ON lu.id = g.owner_user_id "
                "ORDER BY g.name"
            ),
            {"uname": username},
        )
        rows = result.mappings().fetchall()
        return [{"id": r["id"], "name": r["name"], "owner_username": r["owner_username"]} for r in rows]


# ── Tag pool ──────────────────────────────────────────────────────────────────

async def get_tags_pool() -> list[str]:
    """Return distinct tags across all groups for autocomplete."""
    async with get_db() as db:
        result = await db.execute(text("SELECT tags FROM groups WHERE tags != '[]'"))
        rows = result.fetchall()

    seen: set[str] = set()
    tags: list[str] = []
    for row in rows:
        for tag in json.loads(row[0] or "[]"):
            lower = tag.lower()
            if lower not in seen:
                seen.add(lower)
                tags.append(tag)
    return sorted(tags)


# ── Self-service join request ─────────────────────────────────────────────────

async def create_join_request(
    group_id: int, user_id: int, username: str, reason: str | None
) -> None:
    """Create a self-service join request (requires PROJ-50 pending_approvals table)."""
    if not await _approval_workflow_available():
        raise NotImplementedError("Self-Service-Beitritt ist erst nach PROJ-50 verfügbar.")

    async with get_db() as db:
        existing = await db.execute(
            text("SELECT id FROM group_members WHERE group_id = :gid AND user_id = :uid"),
            {"gid": group_id, "uid": user_id},
        )
        if existing.fetchone():
            raise ValueError("Du bist bereits Mitglied dieser Gruppe.")

        # PROJ-50 Phase-2: group_join action_type noch nicht im HANDLER_REGISTRY registriert.
        raise NotImplementedError("PROJ-50 Phase-2: group_join noch nicht unterstützt")
