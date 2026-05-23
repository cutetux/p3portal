# p3portal.org
"""PROJ-25: DB-Konfigurationsdatei-Service.

Liest und schreibt /app/data/.db_config (JSON) – außerhalb der Datenbank selbst,
damit die DB-URL vor init_db() bekannt ist (Chicken-and-Egg-Lösung).

Prioritätskette DB-URL:
  1. DB_URL Env-Var          (höchste Priorität – DevOps / CI)
  2. /app/data/.db_config    (Wizard-Konfiguration, persistent)
  3. sqlite+aiosqlite:///…   (SQLite-Default, Fallback)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_CONFIG_FILENAME = ".db_config"


def _config_path(data_dir: str) -> Path:
    return Path(data_dir) / _CONFIG_FILENAME


def read_db_config(data_dir: str) -> dict | None:
    """Return the parsed .db_config dict or None if the file does not exist."""
    path = _config_path(data_dir)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Konnte .db_config nicht lesen: %s", exc)
        return None


def write_db_config(data_dir: str, db_url: str) -> None:
    """Persist db_url to .db_config. Raises on I/O errors."""
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    path = _config_path(data_dir)
    path.write_text(json.dumps({"db_url": db_url}, indent=2), encoding="utf-8")
    logger.info("DB-Konfiguration gespeichert: %s", path)


def get_db_url_from_config(data_dir: str) -> str | None:
    """Return the db_url from .db_config or None."""
    cfg = read_db_config(data_dir)
    if cfg and isinstance(cfg.get("db_url"), str) and cfg["db_url"].strip():
        return cfg["db_url"].strip()
    return None


def build_postgres_url(
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
) -> str:
    """Assemble a postgresql+asyncpg connection URL from individual fields."""
    from urllib.parse import quote_plus
    safe_pw = quote_plus(password)
    safe_user = quote_plus(username)
    return f"postgresql+asyncpg://{safe_user}:{safe_pw}@{host}:{port}/{database}"
