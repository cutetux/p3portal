# p3portal.org
"""PROJ-48: Business-Logik für das Owners-Modul.

Enthält: count / add / remove / transfer / adopt / list-für-User / list-für-Ressource /
         delete-request anlegen.
Cleanup-Hooks sind in cleanup.py.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_user(db, user_id: int) -> dict | None:
    result = await db.execute(
        text("SELECT id, username, active FROM local_users WHERE id = :id"),
        {"id": user_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def _get_node(db, node_id: int) -> dict | None:
    result = await db.execute(
        text("SELECT id, name FROM nodes WHERE id = :id"),
        {"id": node_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def _enrich_owner_row(db, row: dict) -> dict:
    """Enriches an owner row with username fields."""
    username = None
    assigned_by_username = None

    user_result = await db.execute(
        text("SELECT username FROM local_users WHERE id = :id"),
        {"id": row["user_id"]},
    )
    user_row = user_result.fetchone()
    if user_row:
        username = user_row[0]

    if row.get("assigned_by_user_id"):
        by_result = await db.execute(
            text("SELECT username FROM local_users WHERE id = :id"),
            {"id": row["assigned_by_user_id"]},
        )
        by_row = by_result.fetchone()
        if by_row:
            assigned_by_username = by_row[0]

    return {
        "id": row["id"],
        "resource_type": row["resource_type"],
        "node_id": row["node_id"],
        "vmid": row["vmid"],
        "user_id": row["user_id"],
        "username": username,
        "assigned_at": row["assigned_at"],
        "assigned_by_user_id": row.get("assigned_by_user_id"),
        "assigned_by_username": assigned_by_username,
        "source": row["source"],
    }


# ── count ─────────────────────────────────────────────────────────────────────

async def count_active_ownerships(user_id: int) -> int:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT COUNT(*) FROM vm_owners WHERE user_id = :uid AND deleted_at IS NULL"),
            {"uid": user_id},
        )
        return result.scalar() or 0


async def count_active_ownerships_globally() -> int:
    """Gesamtanzahl aktiver Owner-Einträge (alle User). Für /api/license/status."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT COUNT(*) FROM vm_owners WHERE deleted_at IS NULL"),
        )
        return result.scalar() or 0


# ── list ──────────────────────────────────────────────────────────────────────

async def list_owners_for_resource(resource_type: str, node_id: int, vmid: int) -> list[dict]:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id, resource_type, node_id, vmid, user_id, assigned_at,
                       assigned_by_user_id, source
                  FROM vm_owners
                 WHERE resource_type = :rt AND node_id = :nid AND vmid = :vmid
                   AND deleted_at IS NULL
                 ORDER BY assigned_at ASC
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid},
        )
        rows = result.mappings().fetchall()
        return [await _enrich_owner_row(db, dict(r)) for r in rows]


async def list_owners_for_user(user_id: int) -> list[dict]:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT vo.id, vo.resource_type, vo.node_id, vo.vmid, vo.assigned_at, vo.source,
                       n.name AS node_name
                  FROM vm_owners vo
                  LEFT JOIN nodes n ON n.id = vo.node_id
                 WHERE vo.user_id = :uid AND vo.deleted_at IS NULL
                 ORDER BY vo.assigned_at DESC
            """),
            {"uid": user_id},
        )
        rows = result.mappings().fetchall()
        return [
            {
                "id": r["id"],
                "resource_type": r["resource_type"],
                "node_id": r["node_id"],
                "node_name": r["node_name"],
                "vmid": r["vmid"],
                "assigned_at": r["assigned_at"],
                "source": r["source"],
            }
            for r in rows
        ]


async def bulk_list_owners(resources: list[dict]) -> list[dict]:
    """Bulk-Lookup: gibt alle aktiven Owner für eine Liste von Ressourcen zurück.

    resources: Liste von {resource_type, node_id, vmid}.
    Gibt Liste von {resource_type, node_id, vmid, owners: [...]} zurück.
    """
    if not resources:
        return []

    async with get_db() as db:
        # Alle aktiven Owner in einer Abfrage laden
        result = await db.execute(
            text("""
                SELECT id, resource_type, node_id, vmid, user_id, assigned_at,
                       assigned_by_user_id, source
                  FROM vm_owners
                 WHERE deleted_at IS NULL
                 ORDER BY node_id, vmid, assigned_at ASC
            """),
        )
        all_rows = result.mappings().fetchall()

        # Usernames vorladen
        uid_set = {r["user_id"] for r in all_rows}
        usernames: dict[int, str] = {}
        if uid_set:
            unames_result = await db.execute(
                text(f"SELECT id, username FROM local_users WHERE id IN ({','.join(str(u) for u in uid_set)})")
            )
            for urow in unames_result.fetchall():
                usernames[urow[0]] = urow[1]

    # Gruppieren nach (resource_type, node_id, vmid)
    grouped: dict[tuple, list[dict]] = {}
    for r in all_rows:
        key = (r["resource_type"], r["node_id"], r["vmid"])
        entry = {
            "id": r["id"],
            "resource_type": r["resource_type"],
            "node_id": r["node_id"],
            "vmid": r["vmid"],
            "user_id": r["user_id"],
            "username": usernames.get(r["user_id"]),
            "assigned_at": r["assigned_at"],
            "assigned_by_user_id": r.get("assigned_by_user_id"),
            "assigned_by_username": None,
            "source": r["source"],
        }
        grouped.setdefault(key, []).append(entry)

    # Ergebnis nach angefragten Ressourcen filtern/aufbauen
    result_list = []
    for res in resources:
        key = (res["resource_type"], res["node_id"], res["vmid"])
        result_list.append({
            "resource_type": res["resource_type"],
            "node_id": res["node_id"],
            "vmid": res["vmid"],
            "owners": grouped.get(key, []),
        })
    return result_list


# ── is_owner ──────────────────────────────────────────────────────────────────

async def is_owner(user_id: int, resource_type: str, node_id: int, vmid: int) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT 1 FROM vm_owners
                 WHERE user_id = :uid AND resource_type = :rt
                   AND node_id = :nid AND vmid = :vmid
                   AND deleted_at IS NULL
                 LIMIT 1
            """),
            {"uid": user_id, "rt": resource_type, "nid": node_id, "vmid": vmid},
        )
        return result.fetchone() is not None


async def count_active_owners(resource_type: str, node_id: int, vmid: int) -> int:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT COUNT(*) FROM vm_owners
                 WHERE resource_type = :rt AND node_id = :nid AND vmid = :vmid
                   AND deleted_at IS NULL
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid},
        )
        return result.scalar() or 0


# ── add_owner ─────────────────────────────────────────────────────────────────

async def add_owner(
    resource_type: str,
    node_id: int,
    vmid: int,
    user_id: int,
    actor_user_id: int,
    source: str = "coowner_add",
    actor_username: str = "system",
) -> dict:
    """Fügt einen Owner-Eintrag hinzu. Wirft ValueError bei Limit-Überschreitung oder Duplikat."""
    max_ownerships = plus_behavior.get_max_ownerships()
    if max_ownerships is not None:
        current = await count_active_ownerships(user_id)
        if current >= max_ownerships:
            raise LimitExceededError(
                f"Owner-Limit erreicht ({current}/{max_ownerships}). "
                "Bestehende Eigentümerschaft aufgeben oder auf Plus upgraden, dann erneut deployen."
            )

    async with get_db() as db:
        target = await _get_user(db, user_id)
        if target is None:
            raise KeyError(f"User {user_id} nicht gefunden")
        if not target["active"]:
            raise ValueError(f"User {user_id} ist deaktiviert")

        now = _now()
        try:
            await db.execute(
                text("""
                    INSERT INTO vm_owners
                        (resource_type, node_id, vmid, user_id, assigned_at,
                         assigned_by_user_id, source)
                    VALUES (:rt, :nid, :vmid, :uid, :at, :by_uid, :src)
                """),
                {
                    "rt": resource_type, "nid": node_id, "vmid": vmid,
                    "uid": user_id, "at": now, "by_uid": actor_user_id, "src": source,
                },
            )
            await db.commit()
        except IntegrityError:
            raise DuplicateOwnerError(f"User {user_id} ist bereits aktiver Owner dieser Ressource")

        result = await db.execute(
            text("SELECT id FROM vm_owners WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid AND user_id=:uid AND deleted_at IS NULL"),
            {"rt": resource_type, "nid": node_id, "vmid": vmid, "uid": user_id},
        )
        row_id = result.scalar()

    await write_audit_log(
        "owner_added", actor_username, "local",
        detail=f"Co-Owner user_id={user_id} hinzugefügt zu {resource_type} vmid={vmid} node={node_id}"
    )
    return await _get_single_owner_entry(resource_type, node_id, vmid, user_id)


async def _get_single_owner_entry(resource_type: str, node_id: int, vmid: int, user_id: int) -> dict:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id, resource_type, node_id, vmid, user_id, assigned_at,
                       assigned_by_user_id, source
                  FROM vm_owners
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND user_id=:uid AND deleted_at IS NULL
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid, "uid": user_id},
        )
        row = result.mappings().fetchone()
        if row is None:
            raise KeyError("Owner-Eintrag nicht gefunden")
        return await _enrich_owner_row(db, dict(row))


# ── remove_owner ──────────────────────────────────────────────────────────────

async def remove_owner(
    resource_type: str,
    node_id: int,
    vmid: int,
    user_id: int,
    actor_user_id: int,
    actor_username: str,
    orphan: bool = False,
    deleted_reason: str = "admin_removed",
) -> None:
    """Entfernt einen aktiven Owner-Eintrag (Soft-Delete).

    Wenn user_id der letzte Owner ist, muss orphan=True übergeben werden.
    """
    async with get_db() as db:
        # Prüfen ob Eintrag existiert
        result = await db.execute(
            text("""
                SELECT id FROM vm_owners
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND user_id=:uid AND deleted_at IS NULL
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid, "uid": user_id},
        )
        row = result.fetchone()
        if row is None:
            raise KeyError(f"User {user_id} ist kein aktiver Owner dieser Ressource")

        # Letzter-Owner-Check
        active_count = await count_active_owners(resource_type, node_id, vmid)
        if active_count == 1 and not orphan:
            raise LastOwnerError(
                "Du bist der letzte Owner. Setze orphan=true um die Ressource zu verwaisen."
            )

        now = _now()
        reason = deleted_reason if active_count > 1 else "last_owner_orphaned"
        await db.execute(
            text("""
                UPDATE vm_owners
                   SET deleted_at = :now, deleted_reason = :reason
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND user_id=:uid AND deleted_at IS NULL
            """),
            {"now": now, "reason": reason, "rt": resource_type, "nid": node_id, "vmid": vmid, "uid": user_id},
        )
        await db.commit()

    await write_audit_log(
        "owner_removed", actor_username, "local",
        detail=f"Owner user_id={user_id} entfernt von {resource_type} vmid={vmid} node={node_id} (reason={reason})"
    )


# ── transfer_owner ────────────────────────────────────────────────────────────

async def transfer_owner(
    resource_type: str,
    node_id: int,
    vmid: int,
    from_user_id: int,
    to_user_id: int,
    actor_user_id: int,
    actor_username: str,
) -> dict:
    """Überträgt Eigentum von from_user auf to_user (atomic DELETE + INSERT)."""
    max_ownerships = plus_behavior.get_max_ownerships()
    if max_ownerships is not None:
        current = await count_active_ownerships(to_user_id)
        if current >= max_ownerships:
            raise LimitExceededError(
                f"Ziel-User hat das Owner-Limit erreicht ({current}/{max_ownerships})"
            )

    async with get_db() as db:
        # Prüfen ob from_user aktiver Owner
        result = await db.execute(
            text("""
                SELECT id FROM vm_owners
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND user_id=:uid AND deleted_at IS NULL
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid, "uid": from_user_id},
        )
        if result.fetchone() is None:
            raise KeyError(f"User {from_user_id} ist kein aktiver Owner dieser Ressource")

        to_user = await _get_user(db, to_user_id)
        if to_user is None:
            raise KeyError(f"Ziel-User {to_user_id} nicht gefunden")
        if not to_user["active"]:
            raise ValueError(f"Ziel-User {to_user_id} ist deaktiviert")

        now = _now()
        # Alten Eintrag soft-löschen
        await db.execute(
            text("""
                UPDATE vm_owners SET deleted_at=:now, deleted_reason='transferred'
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND user_id=:from_uid AND deleted_at IS NULL
            """),
            {"now": now, "rt": resource_type, "nid": node_id, "vmid": vmid, "from_uid": from_user_id},
        )
        # Neuen Eintrag anlegen
        try:
            await db.execute(
                text("""
                    INSERT INTO vm_owners
                        (resource_type, node_id, vmid, user_id, assigned_at,
                         assigned_by_user_id, source)
                    VALUES (:rt, :nid, :vmid, :uid, :at, :by_uid, 'transfer')
                """),
                {
                    "rt": resource_type, "nid": node_id, "vmid": vmid,
                    "uid": to_user_id, "at": now, "by_uid": actor_user_id,
                },
            )
        except IntegrityError:
            raise DuplicateOwnerError(f"Ziel-User {to_user_id} ist bereits aktiver Owner")
        await db.commit()

    await write_audit_log(
        "owner_transferred", actor_username, "local",
        detail=f"Eigentum übertragen: from_user={from_user_id} to_user={to_user_id} "
               f"{resource_type} vmid={vmid} node={node_id}"
    )
    return await _get_single_owner_entry(resource_type, node_id, vmid, to_user_id)


# ── adopt ─────────────────────────────────────────────────────────────────────

async def adopt(
    resource_type: str,
    node_id: int,
    vmid: int,
    actor_user_id: int,
    actor_username: str,
) -> dict:
    """Adoptiert eine externe VM (Admin-only bis PROJ-50)."""
    # Prüfen ob bereits aktiver Owner existiert
    active = await count_active_owners(resource_type, node_id, vmid)
    if active > 0:
        raise DuplicateOwnerError("Ressource hat bereits einen aktiven Owner")

    max_ownerships = plus_behavior.get_max_ownerships()
    if max_ownerships is not None:
        current = await count_active_ownerships(actor_user_id)
        if current >= max_ownerships:
            raise LimitExceededError(
                f"Owner-Limit erreicht ({current}/{max_ownerships})"
            )

    async with get_db() as db:
        now = _now()
        await db.execute(
            text("""
                INSERT INTO vm_owners
                    (resource_type, node_id, vmid, user_id, assigned_at,
                     assigned_by_user_id, source)
                VALUES (:rt, :nid, :vmid, :uid, :at, :by_uid, 'adopt')
            """),
            {
                "rt": resource_type, "nid": node_id, "vmid": vmid,
                "uid": actor_user_id, "at": now, "by_uid": actor_user_id,
            },
        )
        await db.commit()

    await write_audit_log(
        "owner_adopted", actor_username, "local",
        detail=f"Externe Ressource adoptiert: {resource_type} vmid={vmid} node={node_id}"
    )
    return await _get_single_owner_entry(resource_type, node_id, vmid, actor_user_id)


# ── delete-request ────────────────────────────────────────────────────────────

async def create_delete_request(
    resource_type: str,
    node_id: int,
    vmid: int,
    requested_by_user_id: int,
    actor_username: str,
    reason: str | None = None,
) -> dict:
    """Stellt einen Löschantrag für eine Ressource (PROJ-50-Stub)."""
    if not await is_owner(requested_by_user_id, resource_type, node_id, vmid):
        raise PermissionError("Nur aktive Owner dürfen einen Löschantrag stellen")

    async with get_db() as db:
        now = _now()
        await db.execute(
            text("""
                INSERT INTO owner_delete_requests
                    (resource_type, node_id, vmid, requested_by_user_id, requested_at, reason, status)
                VALUES (:rt, :nid, :vmid, :uid, :at, :reason, 'pending')
            """),
            {
                "rt": resource_type, "nid": node_id, "vmid": vmid,
                "uid": requested_by_user_id, "at": now, "reason": reason,
            },
        )
        await db.commit()
        result = await db.execute(
            text("""
                SELECT id, resource_type, node_id, vmid, requested_by_user_id,
                       requested_at, reason, status
                  FROM owner_delete_requests
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                   AND requested_by_user_id=:uid
                 ORDER BY id DESC LIMIT 1
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid, "uid": requested_by_user_id},
        )
        row = result.mappings().fetchone()

    await write_audit_log(
        "owner_delete_requested", actor_username, "local",
        detail=f"Löschantrag gestellt: {resource_type} vmid={vmid} node={node_id} reason={reason}"
    )
    return dict(row)


async def list_delete_requests_for_resource(
    resource_type: str, node_id: int, vmid: int
) -> list[dict]:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT id, resource_type, node_id, vmid, requested_by_user_id,
                       requested_at, reason, status, reviewed_by_user_id,
                       reviewed_at, review_reason
                  FROM owner_delete_requests
                 WHERE resource_type=:rt AND node_id=:nid AND vmid=:vmid
                 ORDER BY requested_at DESC
            """),
            {"rt": resource_type, "nid": node_id, "vmid": vmid},
        )
        return [dict(r) for r in result.mappings().fetchall()]


# ── custom exceptions ─────────────────────────────────────────────────────────

class LimitExceededError(Exception):
    pass


class DuplicateOwnerError(Exception):
    pass


class LastOwnerError(Exception):
    pass
