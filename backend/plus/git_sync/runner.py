# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Async Git-Subprocess-Wrapper für Clone, Fetch und Item-Iteration.

Sicherheitshinweise:
- HTTPS: Token wird in die URL eingebettet (https://user:token@host/repo)
- SSH: Private Key → Tempfile mit chmod 600, GIT_SSH_COMMAND gesetzt
- Symlinks im geklonten Repo werden ignoriert (Sicherheit, Edge Case 8)
- Timeout: 60 Sekunden pro git-Befehl (Edge Case 1)
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import NamedTuple

logger = logging.getLogger(__name__)

_GIT_TIMEOUT = 60    # Sekunden (Edge Case 1)
_OUTPUT_LIMIT = 10 * 1024  # 10 KB


class GitRunResult(NamedTuple):
    returncode: int
    stdout: str
    stderr: str


class ItemInfo(NamedTuple):
    item_id: str      # Verzeichnisname
    item_path: Path   # absoluter Pfad zum Item-Verzeichnis im Clone
    git_hash: str     # aktueller Commit-Hash des Repos (HEAD)


async def _run_git(cmd: list[str], cwd: str | None = None, env: dict | None = None) -> GitRunResult:
    """Führt einen git-Befehl async aus. Gibt GitRunResult zurück."""
    full_env = {**os.environ, **(env or {})}
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=full_env,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=_GIT_TIMEOUT
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            return GitRunResult(-1, "", f"git timeout after {_GIT_TIMEOUT}s")

        stdout = stdout_b.decode("utf-8", errors="replace")[:_OUTPUT_LIMIT]
        stderr = stderr_b.decode("utf-8", errors="replace")[:_OUTPUT_LIMIT]
        return GitRunResult(proc.returncode or 0, stdout, stderr)

    except FileNotFoundError:
        return GitRunResult(-2, "", "git: command not found – ist git im Container installiert?")
    except Exception as exc:
        return GitRunResult(-3, "", f"unexpected git error: {exc}")


def _build_https_url(repo_url: str, username: str | None, token: str | None) -> str:
    """Bettet username:token in die HTTPS-URL ein."""
    if not (username and token):
        return repo_url
    # https://host/path → https://user:token@host/path
    if repo_url.startswith("https://"):
        return f"https://{username}:{token}@{repo_url[8:]}"
    if repo_url.startswith("http://"):
        return f"http://{username}:{token}@{repo_url[7:]}"
    return repo_url


async def clone_repo(
    repo_url: str,
    branch: str,
    clone_dir: Path,
    auth_method: str,
    https_username: str | None,
    https_token: str | None,
    ssh_private_key: str | None,
) -> GitRunResult:
    """Führt git clone --depth 1 aus. clone_dir darf noch nicht existieren."""
    clone_dir.parent.mkdir(parents=True, exist_ok=True)
    env: dict[str, str] = {}
    tmp_key_path: Path | None = None

    try:
        if auth_method == "ssh" and ssh_private_key:
            tmp_key_path = Path(tempfile.gettempdir()) / f"p3-git-{uuid.uuid4().hex}"
            tmp_key_path.write_text(ssh_private_key)
            tmp_key_path.chmod(0o600)
            env["GIT_SSH_COMMAND"] = (
                f"ssh -i {tmp_key_path} -o StrictHostKeyChecking=no -o BatchMode=yes"
            )
            url = repo_url
        else:
            url = _build_https_url(repo_url, https_username, https_token)

        cmd = [
            "git", "clone",
            "--depth", "1",
            "--branch", branch,
            "--single-branch",
            url,
            str(clone_dir),
        ]
        return await _run_git(cmd, env=env)

    finally:
        if tmp_key_path:
            try:
                tmp_key_path.unlink(missing_ok=True)
            except Exception:
                pass


async def fetch_and_reset(
    clone_dir: Path,
    branch: str,
    auth_method: str,
    repo_url: str,
    https_username: str | None,
    https_token: str | None,
    ssh_private_key: str | None,
) -> GitRunResult:
    """Aktualisiert einen vorhandenen Clone: fetch origin + reset --hard."""
    env: dict[str, str] = {}
    tmp_key_path: Path | None = None
    cwd = str(clone_dir)

    try:
        if auth_method == "ssh" and ssh_private_key:
            tmp_key_path = Path(tempfile.gettempdir()) / f"p3-git-{uuid.uuid4().hex}"
            tmp_key_path.write_text(ssh_private_key)
            tmp_key_path.chmod(0o600)
            env["GIT_SSH_COMMAND"] = (
                f"ssh -i {tmp_key_path} -o StrictHostKeyChecking=no -o BatchMode=yes"
            )
        else:
            # HTTPS: Remote-URL mit Token aktualisieren falls Token gesetzt
            new_url = _build_https_url(repo_url, https_username, https_token)
            if new_url != repo_url:
                set_url_result = await _run_git(
                    ["git", "remote", "set-url", "origin", new_url],
                    cwd=cwd, env=env,
                )
                if set_url_result.returncode != 0:
                    return set_url_result

        # fetch
        fetch_result = await _run_git(
            ["git", "fetch", "--depth", "1", "origin", branch],
            cwd=cwd, env=env,
        )
        if fetch_result.returncode != 0:
            return fetch_result

        # reset --hard
        return await _run_git(
            ["git", "reset", "--hard", f"origin/{branch}"],
            cwd=cwd, env=env,
        )

    finally:
        if tmp_key_path:
            try:
                tmp_key_path.unlink(missing_ok=True)
            except Exception:
                pass


async def get_current_hash(clone_dir: Path) -> str | None:
    """Gibt den aktuellen HEAD-Commit-Hash zurück."""
    result = await _run_git(
        ["git", "rev-parse", "HEAD"],
        cwd=str(clone_dir),
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None


def collect_items(source_dir: Path) -> list[ItemInfo]:
    """Sammelt alle Item-Verzeichnisse mit meta.yaml aus source_dir.

    - Ignoriert Symlinks (Edge Case 8)
    - Sucht direkte Unterverzeichnisse (depth 1)
    """
    items: list[ItemInfo] = []
    if not source_dir.is_dir():
        return items

    # git_hash wird pro Item identisch sein (HEAD des Repos)
    # Wir geben einen Platzhalter zurück; der Aufrufer setzt den Hash
    for entry in source_dir.iterdir():
        if entry.is_symlink():
            logger.debug("Symlink ignoriert: %s", entry)
            continue
        if not entry.is_dir():
            continue
        meta_yaml = entry / "meta.yaml"
        if not meta_yaml.exists():
            logger.debug("Kein meta.yaml in %s – übersprungen", entry)
            continue
        items.append(ItemInfo(
            item_id=entry.name,
            item_path=entry,
            git_hash="",   # wird vom Aufrufer (service.py) gesetzt
        ))
    return items
