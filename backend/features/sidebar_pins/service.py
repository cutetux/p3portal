# p3portal.org
"""PROJ-54: Business-Logik für das Sidebar-Pins-Modul.

Stale-Check beim GET:
  - system_settings_tab / system_settings_sub_tab: Permission-Check
  - node: Lookup in nodes-Tabelle
  - pool: Lookup in pools-Tabelle
  - group: Lookup in groups-Tabelle
  - vm / lxc: Lookup ob der referenzierte Node noch existiert (node_db_id aus resource_ref)
  - other: kein automatischer Stale-Check

Limit-Logik:
  - Core:  >= CORE_MAX_SIDEBAR_PINS  → 403 "pin_limit_reached"
  - Plus:  >= PLUS_SOFT_WARN_PINS    → Pin anlegen + warning in Response
  - Plus:  >= PLUS_HARD_MAX_PINS     → 403 "pin_hard_limit_reached"
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.core import license as _license
from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _compactify_positions(db, user_id: int) -> None:
    """Stellt lückenlose 0-basierte Positionen nach Löschen/Reorder sicher."""
    result = await db.execute(
        text(
            "SELECT id FROM user_sidebar_pins "
            "WHERE user_id = :uid ORDER BY position ASC"
        ),
        {"uid": user_id},
    )
    rows = result.fetchall()
    for new_pos, row in enumerate(rows):
        await db.execute(
            text("UPDATE user_sidebar_pins SET position = :pos WHERE id = :id"),
            {"pos": new_pos, "id": row[0]},
        )


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "route": row["route"],
        "label": row["label"],
        "position": row["position"],
        "pin_kind": row["pin_kind"],
        "resource_ref": row["resource_ref"],
        "created_at": row["created_at"],
    }


# ── Permission-Check Helpers für Stale-Detection ──────────────────────────────

_PERM_FOR_TAB: dict[str, str | None] = {
    "/system-settings": None,                         # alle eingeloggten Admins
    "/system-settings?tab=portal": None,
    "/system-settings?tab=nodes": None,
    "/system-settings?tab=users": None,
    "/system-settings?tab=content": None,
    "/system-settings?tab=integrations": None,
    "/system-settings?tab=monitoring": None,
    "/system-settings?sub=groups&tab=users": "manage_groups",
    "/system-settings?sub=presets&tab=users": None,
    "/system-settings?tab=pools": "manage_pools",
}


def _is_tab_stale(route: str, user_permissions: list[str], is_admin: bool, is_plus: bool) -> bool:
    """Prüft ob ein System-Settings-Tab-Pin noch berechtigt ist."""
    required = _PERM_FOR_TAB.get(route)
    if required is None:
        return False  # keine spezielle Permission nötig
    if required == "manage_pools" and not is_plus:
        return True  # Plus abgelaufen
    if required not in user_permissions and not is_admin:
        return True  # Permission verloren
    return False


async def _check_db_resource(db, table: str, resource_id: int) -> bool:
    """Gibt True zurück wenn die Ressource noch in der DB existiert."""
    result = await db.execute(
        text(f"SELECT 1 FROM {table} WHERE id = :id"),  # noqa: S608
        {"id": resource_id},
    )
    return result.fetchone() is not None


async def _is_pin_stale(
    db,
    pin: dict,
    user_permissions: list[str],
    is_admin: bool,
    is_plus: bool,
    node_ids: set[int],
    pool_ids: set[int],
    group_ids: set[int],
    node_names: set[str],
) -> str | None:
    """Gibt den Stale-Reason zurück oder None wenn der Pin gültig ist."""
    kind = pin["pin_kind"]
    ref = pin["resource_ref"]

    if kind in ("system_settings_tab", "system_settings_sub_tab"):
        if _is_tab_stale(pin["route"], user_permissions, is_admin, is_plus):
            return "permission_lost" if is_plus else "permission_lost"

    elif kind == "node":
        if ref is not None:
            try:
                node_id = int(ref)
                if node_id not in node_ids:
                    return "not_found"
            except (ValueError, TypeError):
                return "not_found"

    elif kind == "pool":
        if not is_plus:
            return "plus_lost"
        if ref is not None:
            try:
                pool_id = int(ref)
                if pool_id not in pool_ids:
                    return "not_found"
            except (ValueError, TypeError):
                return "not_found"

    elif kind == "group":
        if ref is not None:
            try:
                group_id = int(ref)
                if group_id not in group_ids:
                    return "not_found"
            except (ValueError, TypeError):
                return "not_found"

    elif kind == "node_tab":
        # resource_ref = proxmox_node-Name (z.B. "pve1")
        if ref is not None:
            if ref not in node_names:
                return "not_found"

    elif kind in ("vm", "lxc"):
        # Prüft ob der referenzierte Node (Format: "node_db_id:vmid") noch existiert.
        if ref is not None:
            parts = ref.split(":", 1)
            if parts:
                try:
                    node_id = int(parts[0])
                    if node_id not in node_ids:
                        return "not_found"
                except (ValueError, TypeError):
                    return "not_found"

    return None


async def _bulk_fetch_ids(db, table: str) -> set[int]:
    result = await db.execute(text(f"SELECT id FROM {table}"))  # noqa: S608
    return {row[0] for row in result.fetchall()}


async def _bulk_fetch_node_names(db) -> set[str]:
    """Gibt alle bekannten Proxmox-Node-Namen zurück (für node_tab Stale-Check).

    Inkludiert proxmox_node (primärer API-Endpunkt) sowie alle Namen aus dem
    cluster_nodes-JSON-Array (alle Cluster-Mitglieder), damit Pins auf
    sekundäre Cluster-Nodes nicht fälschlicherweise als stale gelten.
    """
    import json as _json
    result = await db.execute(
        text("SELECT proxmox_node, cluster_nodes FROM nodes WHERE proxmox_node IS NOT NULL")
    )
    names: set[str] = set()
    for row in result.fetchall():
        if row[0]:
            names.add(row[0])
        try:
            extras = _json.loads(row[1] or "[]")
            if isinstance(extras, list):
                names.update(str(n) for n in extras if n)
        except Exception:
            pass
    return names


# ── Stale-Cleanup ─────────────────────────────────────────────────────────────

async def _run_stale_cleanup(
    db,
    user_id: int,
    username: str,
    user_permissions: list[str],
    is_admin: bool,
    is_plus: bool,
) -> list[dict]:
    """Löscht stale Pins und kompaktiert Positionen. Gibt verbleibende Pins zurück."""
    result = await db.execute(
        text(
            "SELECT * FROM user_sidebar_pins "
            "WHERE user_id = :uid ORDER BY position ASC"
        ),
        {"uid": user_id},
    )
    pins = [_row_to_dict(r) for r in result.mappings().fetchall()]

    if not pins:
        return pins

    # Candidate pool_ids für Plus-Protocol-Hook extrahieren (PROJ-62)
    candidate_pool_ids: set[int] = set()
    for pin in pins:
        if pin.get("pin_kind") == "pool" and pin.get("resource_ref"):
            try:
                candidate_pool_ids.add(int(pin["resource_ref"]))
            except (ValueError, TypeError):
                pass

    # Bulk-Lookups parallelisieren für Performance
    node_ids, pool_ids, group_ids, node_names = await asyncio.gather(
        _bulk_fetch_ids(db, "nodes"),
        plus_behavior.get_existing_pool_ids(candidate_pool_ids),
        _bulk_fetch_ids(db, "groups"),
        _bulk_fetch_node_names(db),
    )

    stale_ids: list[int] = []
    audit_items: list[dict] = []
    for pin in pins:
        reason = await _is_pin_stale(
            db, pin, user_permissions, is_admin, is_plus,
            node_ids, pool_ids, group_ids, node_names,
        )
        if reason:
            stale_ids.append(pin["id"])
            audit_items.append({"route": pin["route"], "reason": reason})

    if stale_ids:
        placeholders = ", ".join(f":id{i}" for i in range(len(stale_ids)))
        params = {f"id{i}": sid for i, sid in enumerate(stale_ids)}
        await db.execute(
            text(f"DELETE FROM user_sidebar_pins WHERE id IN ({placeholders})"),  # noqa: S608
            params,
        )
        await _compactify_positions(db, user_id)
        await db.commit()

        for item in audit_items:
            await write_audit_log(
                "sidebar_pin_auto_removed",
                username=username,
                detail=json.dumps(
                    {"user_id": user_id, "route": item["route"], "reason": item["reason"]}
                ),
            )

        # Pins nach Cleanup neu laden
        result = await db.execute(
            text(
                "SELECT * FROM user_sidebar_pins "
                "WHERE user_id = :uid ORDER BY position ASC"
            ),
            {"uid": user_id},
        )
        pins = [_row_to_dict(r) for r in result.mappings().fetchall()]

    return pins


# ── Public API ────────────────────────────────────────────────────────────────

async def list_pins(
    user_id: int,
    username: str,
    user_permissions: list[str],
    is_admin: bool,
    is_plus: bool,
) -> list[dict]:
    """Gibt alle Pins sortiert nach Position zurück; führt Stale-Cleanup durch."""
    async with get_db() as db:
        return await _run_stale_cleanup(
            db, user_id, username, user_permissions, is_admin, is_plus
        )


async def add_pin(
    user_id: int,
    username: str,
    is_plus: bool,
    route: str,
    label: str | None,
    pin_kind: str,
    resource_ref: str | None,
) -> tuple[dict, str | None]:
    """Legt einen neuen Pin an.

    Returns:
        (pin_dict, warning_str | None)

    Raises:
        PermissionError: mit detail "pin_limit_reached" oder "pin_hard_limit_reached"
        ValueError: wenn Route bereits gepinnt ist
    """
    soft_max = plus_behavior.get_max_sidebar_pins()  # Core: 5, Plus: 10
    hard_max = _license.PLUS_HARD_MAX_PINS   # immer 25

    async with get_db() as db:
        count_result = await db.execute(
            text("SELECT COUNT(*) FROM user_sidebar_pins WHERE user_id = :uid"),
            {"uid": user_id},
        )
        current_count = count_result.scalar() or 0

        if not is_plus:
            # Core: hartes Limit
            if current_count >= soft_max:
                await write_audit_log(
                    "sidebar_pin_limit_reached",
                    username=username,
                    detail=json.dumps(
                        {"current_count": current_count, "max": soft_max, "edition": "core"}
                    ),
                )
                raise PermissionError(
                    json.dumps(
                        {
                            "detail": "pin_limit_reached",
                            "current": current_count,
                            "max": soft_max,
                            "edition": "core",
                        }
                    )
                )
        else:
            # Plus: Sanity-Cap
            if current_count >= hard_max:
                raise PermissionError(
                    json.dumps(
                        {
                            "detail": "pin_hard_limit_reached",
                            "current": current_count,
                            "max": hard_max,
                            "edition": "plus",
                        }
                    )
                )

        # Position = MAX + 1 (atomar wegen Transaktion)
        max_pos_result = await db.execute(
            text(
                "SELECT COALESCE(MAX(position), -1) FROM user_sidebar_pins WHERE user_id = :uid"
            ),
            {"uid": user_id},
        )
        max_val = max_pos_result.scalar()
        next_pos = (max_val if max_val is not None else -1) + 1

        now = _now()
        try:
            result = await db.execute(
                text(
                    "INSERT INTO user_sidebar_pins "
                    "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                    "VALUES (:uid, :route, :label, :pos, :kind, :ref, :now) "
                    "RETURNING id"
                ),
                {
                    "uid": user_id,
                    "route": route,
                    "label": label,
                    "pos": next_pos,
                    "kind": pin_kind,
                    "ref": resource_ref,
                    "now": now,
                },
            )
            pin_id = result.fetchone()[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError(f"Route '{route}' ist bereits gepinnt.")

        pin_result = await db.execute(
            text("SELECT * FROM user_sidebar_pins WHERE id = :id"),
            {"id": pin_id},
        )
        pin = _row_to_dict(pin_result.mappings().fetchone())

    await write_audit_log(
        "sidebar_pin_added",
        username=username,
        detail=json.dumps(
            {
                "route": route,
                "pin_kind": pin_kind,
                "position": next_pos,
                "label_present": label is not None,
            }
        ),
    )

    warning: str | None = None
    if is_plus and current_count + 1 > _license.PLUS_SOFT_WARN_PINS:
        warning = "pin_soft_limit"

    return pin, warning


async def update_pin_label(
    pin_id: int,
    user_id: int,
    username: str,
    label: str | None,
) -> dict | None:
    """Ändert das Custom-Label eines Pins. Gibt None zurück wenn nicht gefunden."""
    async with get_db() as db:
        check = await db.execute(
            text(
                "SELECT id FROM user_sidebar_pins WHERE id = :id AND user_id = :uid"
            ),
            {"id": pin_id, "uid": user_id},
        )
        if not check.fetchone():
            return None  # 404 – kein Cross-User-Leak

        await db.execute(
            text(
                "UPDATE user_sidebar_pins SET label = :label WHERE id = :id"
            ),
            {"label": label, "id": pin_id},
        )
        await db.commit()

        result = await db.execute(
            text("SELECT * FROM user_sidebar_pins WHERE id = :id"),
            {"id": pin_id},
        )
        pin = _row_to_dict(result.mappings().fetchone())

    await write_audit_log(
        "sidebar_pin_renamed",
        username=username,
        detail=json.dumps({"route": pin["route"], "new_label_present": label is not None}),
    )
    return pin


async def delete_pin(pin_id: int, user_id: int, username: str) -> bool:
    """Entfernt einen Pin und kompaktiert Positionen."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT route, pin_kind FROM user_sidebar_pins "
                "WHERE id = :id AND user_id = :uid"
            ),
            {"id": pin_id, "uid": user_id},
        )
        row = result.fetchone()
        if not row:
            return False

        route, pin_kind = row
        await db.execute(
            text("DELETE FROM user_sidebar_pins WHERE id = :id"),
            {"id": pin_id},
        )
        await _compactify_positions(db, user_id)
        await db.commit()

    await write_audit_log(
        "sidebar_pin_removed",
        username=username,
        detail=json.dumps({"route": route, "pin_kind": pin_kind}),
    )
    return True


async def reorder_pins(user_id: int, username: str, pin_ids: list[int]) -> list[dict]:
    """Sortiert Pins atomarisch in der angegebenen Reihenfolge.

    Raises:
        ValueError: wenn pin_ids nicht vollständig oder fremd sind (409-Case)
    """
    async with get_db() as db:
        # Alle Pins des Users laden
        result = await db.execute(
            text("SELECT id FROM user_sidebar_pins WHERE user_id = :uid"),
            {"uid": user_id},
        )
        existing_ids = {row[0] for row in result.fetchall()}

        # Prüfen ob input vollständig und nicht fremd
        input_set = set(pin_ids)
        if input_set != existing_ids:
            raise ValueError(
                json.dumps(
                    {
                        "detail": "reorder_mismatch",
                        "expected_count": len(existing_ids),
                        "got_count": len(pin_ids),
                        "current_ids": sorted(existing_ids),
                    }
                )
            )

        for new_pos, pid in enumerate(pin_ids):
            await db.execute(
                text(
                    "UPDATE user_sidebar_pins SET position = :pos WHERE id = :id AND user_id = :uid"
                ),
                {"pos": new_pos, "id": pid, "uid": user_id},
            )
        await db.commit()

        result = await db.execute(
            text(
                "SELECT * FROM user_sidebar_pins "
                "WHERE user_id = :uid ORDER BY position ASC"
            ),
            {"uid": user_id},
        )
        pins = [_row_to_dict(r) for r in result.mappings().fetchall()]

    await write_audit_log(
        "sidebar_pin_reordered",
        username=username,
        detail=json.dumps({"new_order": [p["route"] for p in pins]}),
    )
    return pins


# ── Resource-Delete Hooks ─────────────────────────────────────────────────────

async def cleanup_pins_for_user(user_id: int, username: str, deleted_by: str) -> None:
    """Entfernt alle Pins eines gelöschten Nutzers (wird vor User-Delete aufgerufen).

    DB-Cascade erledigt das DELETE; diese Funktion schreibt nur Audit-Logs.
    """
    async with get_db() as db:
        result = await db.execute(
            text("SELECT route FROM user_sidebar_pins WHERE user_id = :uid"),
            {"uid": user_id},
        )
        routes = [row[0] for row in result.fetchall()]

    for route in routes:
        await write_audit_log(
            "sidebar_pin_auto_removed",
            username=deleted_by,
            detail=json.dumps(
                {"user_id": user_id, "route": route, "reason": "user_deleted"}
            ),
        )


async def cleanup_pins_for_resource(
    resource_kind: str,
    resource_ref: str,
    deleted_by: str,
) -> None:
    """Entfernt alle Pins auf eine gelöschte Ressource (Pool, Gruppe, Node, VM).

    Wird aus den jeweiligen Delete-Services aufgerufen (Service-Hook, AC-STALE-3).
    """
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, user_id, route FROM user_sidebar_pins "
                "WHERE pin_kind = :kind AND resource_ref = :ref"
            ),
            {"kind": resource_kind, "ref": resource_ref},
        )
        rows = result.mappings().fetchall()

        if not rows:
            return

        stale_ids = [r["id"] for r in rows]
        audit_items = [{"user_id": r["user_id"], "route": r["route"]} for r in rows]

        placeholders = ", ".join(f":id{i}" for i in range(len(stale_ids)))
        params = {f"id{i}": sid for i, sid in enumerate(stale_ids)}
        await db.execute(
            text(f"DELETE FROM user_sidebar_pins WHERE id IN ({placeholders})"),  # noqa: S608
            params,
        )

        # Positionen pro User kompaktieren
        affected_users: set[int] = {r["user_id"] for r in rows}
        for uid in affected_users:
            await _compactify_positions(db, uid)

        await db.commit()

    for item in audit_items:
        await write_audit_log(
            "sidebar_pin_auto_removed",
            username=deleted_by,
            detail=json.dumps(
                {
                    "user_id": item["user_id"],
                    "route": item["route"],
                    "reason": "not_found",
                }
            ),
        )
