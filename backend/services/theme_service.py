# p3portal.org
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db

_ASSETS_DIR = Path(__file__).parent.parent / "assets" / "themes"
_BUILTIN_IDS = {"dark", "p3orange", "light", "hc"}
_REQUIRED_VARS = {
    "--sidebar", "--bg", "--bg2", "--bg3", "--border", "--border2",
    "--text", "--text2", "--text3", "--white", "--accent",
    "--green", "--orange", "--blue", "--purple", "--red",
}

MAX_THEME_BYTES = 100 * 1024  # 100 KB


def _data_dir() -> Path:
    p = Path(settings.data_dir) / "themes"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _load_vars(theme_id: str, file_path: str | None, is_builtin: bool) -> dict[str, str]:
    if is_builtin:
        src = _ASSETS_DIR / f"{theme_id}.json"
    else:
        src = Path(file_path) if file_path else None
    if not src or not src.exists():
        return {}
    data = json.loads(src.read_text(encoding="utf-8"))
    return data.get("variables", {})


async def seed_builtin_themes() -> None:
    """Idempotently register built-in themes in the DB."""
    now = datetime.now(timezone.utc).isoformat()
    for theme_file in sorted(_ASSETS_DIR.glob("*.json")):
        theme_id = theme_file.stem
        data = json.loads(theme_file.read_text(encoding="utf-8"))
        name = data.get("name", theme_id)
        async with get_db() as session:
            await session.execute(
                text(
                    """INSERT INTO themes (id, name, author, is_builtin, file_path, created_at)
                       VALUES (:id, :name, :author, 1, NULL, :created_at)
                       ON CONFLICT(id) DO UPDATE SET name = excluded.name"""
                ),
                {"id": theme_id, "name": name, "author": "p3portal.org", "created_at": now},
            )
            await session.commit()


async def list_themes() -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT id, name, is_builtin, file_path FROM themes ORDER BY is_builtin DESC, name")
        )
        rows = result.mappings().fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "is_builtin": bool(r["is_builtin"]),
            "vars": _load_vars(r["id"], r["file_path"], bool(r["is_builtin"])),
        }
        for r in rows
    ]


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:40] or "theme"


def _make_unique_id(base: str, existing: set[str]) -> str:
    candidate = base
    n = 2
    while candidate in existing:
        candidate = f"{base}-{n}"
        n += 1
    return candidate


async def upload_theme(name: str, variables: dict[str, str], uploader: str) -> dict:
    """Validate and persist a custom theme. Returns the ThemeResponse dict."""
    missing = _REQUIRED_VARS - set(variables.keys())
    if missing:
        raise ValueError(f"Fehlende Pflicht-Variablen: {', '.join(sorted(missing))}")

    async with get_db() as session:
        result = await session.execute(text("SELECT id FROM themes"))
        existing_ids = {r[0] for r in result.fetchall()}

    theme_id = _make_unique_id(_slugify(name), existing_ids)
    dest = _data_dir() / f"{theme_id}.json"
    payload = {"name": name, "author": uploader, "version": "1.0", "variables": variables}
    dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO themes (id, name, author, is_builtin, file_path, created_at)
                   VALUES (:id, :name, :author, 0, :file_path, :created_at)"""
            ),
            {"id": theme_id, "name": name, "author": uploader,
             "file_path": str(dest), "created_at": now},
        )
        await session.commit()

    return {"id": theme_id, "name": name, "is_builtin": False, "vars": variables}


async def create_theme(name: str, variables: dict[str, str], creator: str) -> dict:
    """Create a new custom theme via the editor API. Alias for upload_theme."""
    return await upload_theme(name, variables, creator)


async def update_theme(theme_id: str, name: str, variables: dict[str, str]) -> dict | None:
    """Update name and variables of an existing custom theme. Returns None if not found."""
    if theme_id in _BUILTIN_IDS:
        raise ValueError("Built-in Themes können nicht bearbeitet werden")

    missing = _REQUIRED_VARS - set(variables.keys())
    if missing:
        raise ValueError(f"Fehlende Pflicht-Variablen: {', '.join(sorted(missing))}")

    async with get_db() as session:
        result = await session.execute(
            text("SELECT id, file_path FROM themes WHERE id = :id AND is_builtin = 0"),
            {"id": theme_id},
        )
        row = result.mappings().fetchone()
    if not row:
        return None

    # Check for name collision (exclude self)
    async with get_db() as session:
        result = await session.execute(
            text("SELECT id FROM themes WHERE name = :name AND id != :id"),
            {"name": name, "id": theme_id},
        )
        collision = result.fetchone()
    if collision:
        raise LookupError("name_taken")

    # Update the JSON file
    file_path = row["file_path"]
    if file_path:
        p = Path(file_path)
        if p.exists():
            existing = json.loads(p.read_text(encoding="utf-8"))
            existing["name"] = name
            existing["variables"] = variables
            p.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            # File missing — recreate at the expected path
            dest = _data_dir() / f"{theme_id}.json"
            payload = {"name": name, "author": "portal", "version": "1.0", "variables": variables}
            dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            file_path = str(dest)

    async with get_db() as session:
        await session.execute(
            text("UPDATE themes SET name = :name WHERE id = :id"),
            {"name": name, "id": theme_id},
        )
        await session.commit()

    return {"id": theme_id, "name": name, "is_builtin": False, "vars": variables}


async def delete_theme(theme_id: str) -> bool:
    """Delete a custom theme. Returns False if not found, raises ValueError for built-ins."""
    if theme_id in _BUILTIN_IDS:
        raise ValueError("Built-in Themes können nicht gelöscht werden")

    async with get_db() as session:
        result = await session.execute(
            text("SELECT file_path FROM themes WHERE id = :id AND is_builtin = 0"),
            {"id": theme_id},
        )
        row = result.mappings().fetchone()
        if not row:
            return False
        file_path = row["file_path"]
        await session.execute(text("DELETE FROM themes WHERE id = :id"), {"id": theme_id})
        await session.commit()

    if file_path:
        p = Path(file_path)
        if p.exists():
            p.unlink()
    return True
