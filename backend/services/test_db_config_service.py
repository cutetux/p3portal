# p3portal.org
"""Tests for PROJ-25 db_config_service."""
from __future__ import annotations

import json
import pytest

from backend.services.db_config_service import (
    build_postgres_url,
    get_db_url_from_config,
    read_db_config,
    write_db_config,
)


def test_write_and_read_db_config(tmp_path):
    url = "postgresql+asyncpg://user:pw@host:5432/db"
    write_db_config(str(tmp_path), url)

    cfg = read_db_config(str(tmp_path))
    assert cfg is not None
    assert cfg["db_url"] == url


def test_read_missing_config(tmp_path):
    result = read_db_config(str(tmp_path))
    assert result is None


def test_read_corrupt_config(tmp_path):
    (tmp_path / ".db_config").write_text("not-valid-json", encoding="utf-8")
    result = read_db_config(str(tmp_path))
    assert result is None


def test_get_db_url_from_config(tmp_path):
    url = "postgresql+asyncpg://user:pw@host:5432/db"
    write_db_config(str(tmp_path), url)
    assert get_db_url_from_config(str(tmp_path)) == url


def test_get_db_url_from_config_missing(tmp_path):
    assert get_db_url_from_config(str(tmp_path)) is None


def test_get_db_url_empty_value(tmp_path):
    (tmp_path / ".db_config").write_text(json.dumps({"db_url": ""}), encoding="utf-8")
    assert get_db_url_from_config(str(tmp_path)) is None


def test_build_postgres_url_basic():
    url = build_postgres_url("db.example.com", 5432, "portal", "user", "secret")
    assert url.startswith("postgresql+asyncpg://")
    assert "db.example.com:5432" in url
    assert "portal" in url
    assert "user" in url


def test_build_postgres_url_special_chars():
    """Password with special chars must be URL-encoded."""
    url = build_postgres_url("host", 5432, "db", "user", "p@ss:word!")
    assert "@host" in url
    assert "p@ss:word!" not in url  # raw password must not appear unencoded after @


def test_build_postgres_url_custom_port():
    url = build_postgres_url("host", 15432, "db", "user", "pw")
    assert ":15432/" in url


def test_write_creates_parent_dir(tmp_path):
    nested = tmp_path / "subdir" / "data"
    write_db_config(str(nested), "postgresql+asyncpg://user:pw@h:5432/db")
    assert (nested / ".db_config").exists()
