# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Unit-Tests für den Git-Runner."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.plus.git_sync import runner

pytestmark = pytest.mark.plus_only


# ── _build_https_url ──────────────────────────────────────────────────────────

def test_build_https_url_with_credentials():
    url = runner._build_https_url("https://github.com/org/repo.git", "user", "token123")
    assert url == "https://user:token123@github.com/org/repo.git"


def test_build_https_url_without_credentials():
    url = runner._build_https_url("https://github.com/org/repo.git", None, None)
    assert url == "https://github.com/org/repo.git"


def test_build_https_url_only_token():
    url = runner._build_https_url("https://github.com/org/repo.git", None, "token")
    # Ohne username kein Einbetten
    assert url == "https://github.com/org/repo.git"


def test_build_https_url_http_scheme():
    url = runner._build_https_url("http://internal.host/repo.git", "user", "pw")
    assert url == "http://user:pw@internal.host/repo.git"


def test_build_https_url_ssh_passthrough():
    url = runner._build_https_url("git@github.com:org/repo.git", "user", "token")
    # git@-URL nicht modifiziert
    assert url == "git@github.com:org/repo.git"


# ── collect_items ─────────────────────────────────────────────────────────────

def test_collect_items_finds_directories_with_meta(tmp_path):
    pb1 = tmp_path / "playbook_one"
    pb1.mkdir()
    (pb1 / "meta.yaml").write_text("name: pb1")

    pb2 = tmp_path / "playbook_two"
    pb2.mkdir()
    (pb2 / "meta.yaml").write_text("name: pb2")

    items = runner.collect_items(tmp_path)
    item_ids = {i.item_id for i in items}
    assert item_ids == {"playbook_one", "playbook_two"}


def test_collect_items_ignores_no_meta(tmp_path):
    (tmp_path / "dir_without_meta").mkdir()
    items = runner.collect_items(tmp_path)
    assert items == []


def test_collect_items_ignores_files(tmp_path):
    (tmp_path / "somefile.txt").write_text("text")
    (tmp_path / "validdir").mkdir()
    (tmp_path / "validdir" / "meta.yaml").write_text("name: v")
    items = runner.collect_items(tmp_path)
    assert len(items) == 1
    assert items[0].item_id == "validdir"


def test_collect_items_ignores_symlinks(tmp_path):
    real_dir = tmp_path / "real_dir"
    real_dir.mkdir()
    (real_dir / "meta.yaml").write_text("name: real")

    link = tmp_path / "link_dir"
    link.symlink_to(real_dir)

    items = runner.collect_items(tmp_path)
    # link_dir ist ein Symlink → ignoriert; real_dir hat meta.yaml
    item_ids = {i.item_id for i in items}
    assert "link_dir" not in item_ids
    assert "real_dir" in item_ids


def test_collect_items_empty_dir(tmp_path):
    items = runner.collect_items(tmp_path)
    assert items == []


def test_collect_items_nonexistent_dir(tmp_path):
    items = runner.collect_items(tmp_path / "doesnotexist")
    assert items == []


# ── _run_git ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_git_file_not_found():
    """Wenn git nicht installiert ist → returncode -2."""
    with patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
        result = await runner._run_git(["git", "version"])
    assert result.returncode == -2
    assert "command not found" in result.stderr


@pytest.mark.asyncio
async def test_run_git_timeout():
    """Timeout → returncode -1."""
    import asyncio

    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError)
    mock_proc.kill = MagicMock()

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError):
            result = await runner._run_git(["git", "version"])
    assert result.returncode == -1
    assert "timeout" in result.stderr


# ── clone_repo ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_clone_repo_https(tmp_path):
    """Korrekte git clone Argumente für HTTPS."""
    called_cmd = []

    async def fake_run_git(cmd, cwd=None, env=None):
        called_cmd.extend(cmd)
        return runner.GitRunResult(0, "", "")

    with patch.object(runner, "_run_git", fake_run_git):
        result = await runner.clone_repo(
            repo_url="https://github.com/org/repo.git",
            branch="main",
            clone_dir=tmp_path / "clone",
            auth_method="https",
            https_username="user",
            https_token="token",
            ssh_private_key=None,
        )

    assert result.returncode == 0
    assert "git" in called_cmd
    assert "clone" in called_cmd
    assert "--depth" in called_cmd
    # URL sollte Token enthalten
    url_in_cmd = [c for c in called_cmd if "token" in c]
    assert len(url_in_cmd) > 0


@pytest.mark.asyncio
async def test_clone_repo_creates_parent_dir(tmp_path):
    async def fake_run_git(cmd, cwd=None, env=None):
        return runner.GitRunResult(0, "", "")

    nested = tmp_path / "a" / "b" / "c" / "clone"
    with patch.object(runner, "_run_git", fake_run_git):
        await runner.clone_repo(
            repo_url="https://github.com/org/repo.git",
            branch="main",
            clone_dir=nested,
            auth_method="https",
            https_username=None,
            https_token=None,
            ssh_private_key=None,
        )

    assert nested.parent.exists()


# ── get_current_hash ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_current_hash_success(tmp_path):
    async def fake_run_git(cmd, cwd=None, env=None):
        return runner.GitRunResult(0, "abc1234def5678\n", "")

    with patch.object(runner, "_run_git", fake_run_git):
        h = await runner.get_current_hash(tmp_path)

    assert h == "abc1234def5678"


@pytest.mark.asyncio
async def test_get_current_hash_failure(tmp_path):
    async def fake_run_git(cmd, cwd=None, env=None):
        return runner.GitRunResult(128, "", "not a git repo")

    with patch.object(runner, "_run_git", fake_run_git):
        h = await runner.get_current_hash(tmp_path)

    assert h is None
