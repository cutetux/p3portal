# p3portal.org
"""PROJ-57: Business-Logik für das Help-Override-System.

Priorität bei der Inhaltsauflösung (AC-PROMOTE-7):
  persönlicher User-Override > globaler Override > Repo-Default

Diese Datei implementiert ausschließlich die DB-seitige Logik.
Die clientseitige Resolver-Funktion (Repo-MDs) liegt in frontend/src/features/help/helpResolver.js.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log
from .sanitizer import compute_md5

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Lesende Operationen ────────────────────────────────────────────────────────

async def list_user_overrides(user_id: int) -> list[dict]:
    """Gibt alle persönlichen Overrides eines Users zurück."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, key, lang, scope, owner_user_id, content, content_md5, "
                "       original_uploader_user_id, created_at, updated_at "
                "FROM help_overrides "
                "WHERE scope = 'user' AND owner_user_id = :uid "
                "ORDER BY key, lang"
            ),
            {"uid": user_id},
        )
        return [dict(r._mapping) for r in result.fetchall()]


async def list_global_overrides() -> list[dict]:
    """Gibt alle aktiven globalen Overrides zurück."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT id, key, lang, scope, owner_user_id, content, content_md5, "
                "       original_uploader_user_id, created_at, updated_at "
                "FROM help_overrides "
                "WHERE scope = 'global' "
                "ORDER BY key, lang"
            ),
        )
        return [dict(r._mapping) for r in result.fetchall()]


async def list_all_overrides_admin() -> list[dict]:
    """Gibt alle Overrides (user + global) für den Admin-Tab zurück.

    Joined mit local_users für Uploader-Usernamen.
    """
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT ho.id, ho.key, ho.lang, ho.scope, ho.owner_user_id, "
                "       ho.content, ho.content_md5, ho.original_uploader_user_id, "
                "       ho.created_at, ho.updated_at, "
                "       u1.username AS owner_username, "
                "       u2.username AS original_uploader_username "
                "FROM help_overrides ho "
                "LEFT JOIN local_users u1 ON u1.id = ho.owner_user_id "
                "LEFT JOIN local_users u2 ON u2.id = ho.original_uploader_user_id "
                "ORDER BY ho.scope DESC, ho.key, ho.lang"
            ),
        )
        return [dict(r._mapping) for r in result.fetchall()]


# ── Schreibende Operationen ────────────────────────────────────────────────────

async def upload_user_override(
    *,
    user_id: int,
    username: str,
    key: str,
    lang: str,
    content: str,
    ip_address: str | None = None,
) -> dict:
    """Erstellt oder überschreibt einen persönlichen User-Override.

    Prüft Core-Limit (CORE_MAX_HELP_OVERRIDES_PER_USER) vor dem Anlegen neuer Einträge.
    Update bestehender Overrides ist immer erlaubt (kein Limit-Verstoß).

    Returns:
        dict mit den Daten des neuen/aktualisierten Overrides.
    Raises:
        PermissionError: Core-Limit überschritten.
    """
    md5 = compute_md5(content)
    now = _now()

    async with get_db() as db:
        # Existiert bereits ein Override für diesen Key+Lang?
        existing = await db.execute(
            text(
                "SELECT id FROM help_overrides "
                "WHERE scope = 'user' AND owner_user_id = :uid AND key = :key AND lang = :lang"
            ),
            {"uid": user_id, "key": key, "lang": lang},
        )
        existing_row = existing.fetchone()

        if existing_row is None:
            # Neuer Override → Limit prüfen
            max_overrides = plus_behavior.get_max_help_overrides_per_user()
            if max_overrides is not None:
                count_res = await db.execute(
                    text(
                        "SELECT COUNT(*) FROM help_overrides "
                        "WHERE scope = 'user' AND owner_user_id = :uid"
                    ),
                    {"uid": user_id},
                )
                current_count = count_res.scalar() or 0
                if current_count >= max_overrides:
                    raise PermissionError(
                        f"Max. {max_overrides} eigene Hilfen in Core-Edition. "
                        "Upgrade auf Plus für unbegrenzte Overrides."
                    )

            result = await db.execute(
                text(
                    "INSERT INTO help_overrides "
                    "(key, lang, scope, owner_user_id, content, content_md5, "
                    " original_uploader_user_id, created_at, updated_at) "
                    "VALUES (:key, :lang, 'user', :uid, :content, :md5, :uid, :now, :now) "
                    "RETURNING id"
                ),
                {"key": key, "lang": lang, "uid": user_id, "content": content,
                 "md5": md5, "now": now},
            )
            new_id = result.scalar()
        else:
            # Update bestehenden Override
            await db.execute(
                text(
                    "UPDATE help_overrides "
                    "SET content = :content, content_md5 = :md5, updated_at = :now "
                    "WHERE id = :id"
                ),
                {"content": content, "md5": md5, "now": now, "id": existing_row[0]},
            )
            new_id = existing_row[0]

        await db.commit()

    await write_audit_log(
        event_type="help_user_override_uploaded",
        username=username,
        ip_address=ip_address,
        detail=f'{{"key": "{key}", "lang": "{lang}", "size_bytes": {len(content.encode())}, "content_md5": "{md5}"}}',
    )

    # Aktualisierten Datensatz zurückgeben
    async with get_db() as db:
        row = await db.execute(
            text("SELECT * FROM help_overrides WHERE id = :id"),
            {"id": new_id},
        )
        return dict(row.fetchone()._mapping)


async def delete_override(
    *,
    override_id: int,
    current_user_id: int,
    current_username: str,
    is_admin: bool,
    ip_address: str | None = None,
) -> dict:
    """Löscht einen Override.

    Owner kann eigenen Override löschen. Admin (manage_help) kann jeden Override löschen.
    Global-Overrides können nur über delete_global_override() gelöscht werden.

    Raises:
        LookupError: Override nicht gefunden.
        PermissionError: Kein Recht zum Löschen.
    """
    async with get_db() as db:
        row = await db.execute(
            text("SELECT id, key, lang, scope, owner_user_id FROM help_overrides WHERE id = :id"),
            {"id": override_id},
        )
        record = row.fetchone()
        if record is None:
            raise LookupError(f"Override {override_id} nicht gefunden.")

        rec = dict(record._mapping)

        # Berechtigung prüfen
        if rec["scope"] == "global":
            if not is_admin:
                raise PermissionError("Globale Overrides erfordern manage_help.")
        else:
            if rec["owner_user_id"] != current_user_id and not is_admin:
                raise PermissionError("Kein Zugriff auf fremde Overrides.")

        await db.execute(
            text("DELETE FROM help_overrides WHERE id = :id"),
            {"id": override_id},
        )
        await db.commit()

    deleted_by_self = rec["owner_user_id"] == current_user_id
    event = "help_user_override_moderated" if is_admin and not deleted_by_self else "help_user_override_deleted"
    await write_audit_log(
        event_type=event,
        username=current_username,
        ip_address=ip_address,
        detail=f'{{"key": "{rec["key"]}", "lang": "{rec["lang"]}", "deleted_by_self": {str(deleted_by_self).lower()}}}',
    )
    return rec


async def promote_to_global(
    *,
    override_id: int,
    admin_user_id: int,
    admin_username: str,
    ip_address: str | None = None,
) -> dict:
    """Promotet einen User-Override zum globalen Override.

    Plus-only: Caller muss Plus-Verfügbarkeit (CORE_MAX_HELP_GLOBAL_OVERRIDES > 0 oder None) prüfen.

    Raises:
        LookupError: Override nicht gefunden oder nicht im user-scope.
        ValueError: Bereits ein globaler Override für diesen Key+Lang.
    """
    async with get_db() as db:
        row = await db.execute(
            text(
                "SELECT id, key, lang, scope, content, content_md5, owner_user_id "
                "FROM help_overrides WHERE id = :id"
            ),
            {"id": override_id},
        )
        record = row.fetchone()
        if record is None:
            raise LookupError(f"Override {override_id} nicht gefunden.")
        rec = dict(record._mapping)
        if rec["scope"] != "user":
            raise ValueError("Nur User-Overrides können zu global promotet werden.")

        now = _now()

        # Existiert bereits ein globaler Override? → ersetzen
        existing_global = await db.execute(
            text(
                "SELECT id FROM help_overrides "
                "WHERE scope = 'global' AND key = :key AND lang = :lang"
            ),
            {"key": rec["key"], "lang": rec["lang"]},
        )
        existing_global_row = existing_global.fetchone()

        if existing_global_row:
            await db.execute(
                text(
                    "UPDATE help_overrides "
                    "SET content = :content, content_md5 = :md5, "
                    "    original_uploader_user_id = :uploader, updated_at = :now "
                    "WHERE id = :gid"
                ),
                {
                    "content": rec["content"],
                    "md5": rec["content_md5"],
                    "uploader": rec["owner_user_id"],
                    "now": now,
                    "gid": existing_global_row[0],
                },
            )
            new_global_id = existing_global_row[0]
        else:
            result = await db.execute(
                text(
                    "INSERT INTO help_overrides "
                    "(key, lang, scope, owner_user_id, content, content_md5, "
                    " original_uploader_user_id, created_at, updated_at) "
                    "VALUES (:key, :lang, 'global', NULL, :content, :md5, :uploader, :now, :now) "
                    "RETURNING id"
                ),
                {
                    "key": rec["key"],
                    "lang": rec["lang"],
                    "content": rec["content"],
                    "md5": rec["content_md5"],
                    "uploader": rec["owner_user_id"],
                    "now": now,
                },
            )
            new_global_id = result.scalar()

        await db.commit()

    await write_audit_log(
        event_type="help_global_override_set",
        username=admin_username,
        ip_address=ip_address,
        detail=(
            f'{{"key": "{rec["key"]}", "lang": "{rec["lang"]}", '
            f'"source_user_override_id": {override_id}, '
            f'"original_uploader_user_id": {rec["owner_user_id"]}, '
            f'"content_md5": "{rec["content_md5"]}"}}'
        ),
    )

    async with get_db() as db:
        row = await db.execute(
            text("SELECT * FROM help_overrides WHERE id = :id"),
            {"id": new_global_id},
        )
        return dict(row.fetchone()._mapping)


async def remove_global_override(
    *,
    key: str,
    lang: str,
    admin_username: str,
    ip_address: str | None = None,
) -> dict:
    """Entfernt einen globalen Override (Repo-Default greift wieder).

    Raises:
        LookupError: Kein globaler Override für diesen Key+Lang.
    """
    async with get_db() as db:
        row = await db.execute(
            text(
                "SELECT id, content_md5 FROM help_overrides "
                "WHERE scope = 'global' AND key = :key AND lang = :lang"
            ),
            {"key": key, "lang": lang},
        )
        record = row.fetchone()
        if record is None:
            raise LookupError(
                f"Kein globaler Override für key='{key}', lang='{lang}' gefunden."
            )

        rec = dict(record._mapping)
        await db.execute(
            text("DELETE FROM help_overrides WHERE id = :id"),
            {"id": rec["id"]},
        )
        await db.commit()

    await write_audit_log(
        event_type="help_global_override_removed",
        username=admin_username,
        ip_address=ip_address,
        detail=f'{{"key": "{key}", "lang": "{lang}", "content_md5": "{rec["content_md5"]}"}}'
    )
    return {"deleted_id": rec["id"], "key": key, "lang": lang}
