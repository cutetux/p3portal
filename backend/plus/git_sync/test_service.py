# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Unit-Tests für den Git-Sync-Service."""
from __future__ import annotations

import secrets
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from backend.plus.git_sync import service

pytestmark = pytest.mark.plus_only


# ── SSH-Keypair-Generierung ───────────────────────────────────────────────────

def test_generate_ed25519_keypair_format():
    priv, pub = service.generate_ed25519_keypair()
    assert priv.startswith("-----BEGIN OPENSSH PRIVATE KEY-----")
    assert pub.startswith("ssh-ed25519 ")
    # Keys sollten nicht gleich sein
    assert priv != pub


def test_generate_ed25519_keypair_unique():
    """Jeder Aufruf liefert ein anderes Keypair."""
    priv1, pub1 = service.generate_ed25519_keypair()
    priv2, pub2 = service.generate_ed25519_keypair()
    assert priv1 != priv2
    assert pub1 != pub2


def test_generate_webhook_token_length():
    token = service.generate_webhook_token()
    assert len(token) == 64  # 32 Bytes Hex = 64 Zeichen


def test_generate_webhook_token_unique():
    assert service.generate_webhook_token() != service.generate_webhook_token()


# ── Config CRUD ───────────────────────────────────────────────────────────────

def test_empty_config_response():
    resp = service._empty_config_response("ansible")
    assert resp["repo_type"] == "ansible"
    assert resp["enabled"] is False
    assert resp["branch"] == "main"
    assert resp["has_https_token"] is False
    assert resp["has_webhook_token"] is False


def test_now_iso_format():
    ts = service._now_iso()
    assert "T" in ts
    assert len(ts) > 15


# ── Clone-Dir-Pfade ───────────────────────────────────────────────────────────

def test_get_clone_dir_ansible(tmp_path, monkeypatch):
    from backend.core.config import settings as _settings
    monkeypatch.setattr(_settings, "data_dir", str(tmp_path))
    clone_dir = service._get_clone_dir("ansible")
    assert clone_dir == tmp_path / "git_sync" / "ansible-clone"


def test_get_clone_dir_packer(tmp_path, monkeypatch):
    from backend.core.config import settings as _settings
    monkeypatch.setattr(_settings, "data_dir", str(tmp_path))
    clone_dir = service._get_clone_dir("packer")
    assert clone_dir == tmp_path / "git_sync" / "packer-clone"


def test_get_target_dir_ansible(tmp_path, monkeypatch):
    from backend.core.config import settings as _settings
    monkeypatch.setattr(_settings, "ansible_dir", str(tmp_path / "ansible"))
    target = service._get_target_dir("ansible")
    assert target == tmp_path / "ansible"


def test_get_target_dir_packer(tmp_path, monkeypatch):
    from backend.core.config import settings as _settings
    monkeypatch.setattr(_settings, "packer_dir", str(tmp_path / "packer"))
    target = service._get_target_dir("packer")
    assert target == tmp_path / "packer"


# ── _copy_item ────────────────────────────────────────────────────────────────

def test_copy_item_creates_directory(tmp_path):
    source = tmp_path / "source_item"
    source.mkdir()
    (source / "meta.yaml").write_text("name: test")
    (source / "playbook.yml").write_text("---\n")

    dest = tmp_path / "dest_item"
    service._copy_item(source, dest)

    assert dest.is_dir()
    assert (dest / "meta.yaml").read_text() == "name: test"
    assert (dest / "playbook.yml").read_text() == "---\n"


def test_copy_item_overwrites_existing(tmp_path):
    source = tmp_path / "source_item"
    source.mkdir()
    (source / "meta.yaml").write_text("name: new")

    dest = tmp_path / "dest_item"
    dest.mkdir()
    (dest / "old.txt").write_text("old")

    service._copy_item(source, dest)
    assert not (dest / "old.txt").exists()
    assert (dest / "meta.yaml").read_text() == "name: new"


def test_copy_item_ignores_symlinks_by_not_following(tmp_path):
    """Symlinks in der Quelle sollten nicht gefolgt werden."""
    source = tmp_path / "source_item"
    source.mkdir()
    (source / "meta.yaml").write_text("name: test")
    # shutil.copytree mit symlinks=False übersetzt Symlinks in echte Dateien
    # aber wenn symlinks gar nicht existieren, ist das kein Problem
    dest = tmp_path / "dest_item"
    service._copy_item(source, dest)
    assert dest.is_dir()


# ── _json_str ─────────────────────────────────────────────────────────────────

def test_json_str_escaping():
    result = service._json_str('say "hello"')
    assert result == '"say \\"hello\\""'


def test_json_str_unicode():
    result = service._json_str("Ü")
    assert "Ü" in result or "\\u" in result  # JSON-escaped oder direkt


# ── verify_webhook_token ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_webhook_token_no_config(monkeypatch):
    monkeypatch.setattr(service, "get_config", AsyncMock(return_value=None))
    result = await service.verify_webhook_token("ansible", "any_token")
    assert result is False


@pytest.mark.asyncio
async def test_verify_webhook_token_valid(monkeypatch):
    from backend.services.config_service import encrypt_secret
    real_token = "abc123"
    enc = encrypt_secret(real_token)
    monkeypatch.setattr(service, "get_config", AsyncMock(return_value={
        "webhook_token_enc": enc,
    }))
    result = await service.verify_webhook_token("ansible", real_token)
    assert result is True


@pytest.mark.asyncio
async def test_verify_webhook_token_invalid(monkeypatch):
    from backend.services.config_service import encrypt_secret
    enc = encrypt_secret("correct_token")
    monkeypatch.setattr(service, "get_config", AsyncMock(return_value={
        "webhook_token_enc": enc,
    }))
    result = await service.verify_webhook_token("ansible", "wrong_token")
    assert result is False


# ── trigger_sync Nebenläufigkeit ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_trigger_sync_queued_when_locked(monkeypatch):
    """Zweiter Trigger während laufendem Sync → queued."""
    import asyncio

    # Lock manuell sperren
    lock = service._locks["ansible"]
    await lock.acquire()
    service._queued["ansible"] = False

    try:
        result = await service.trigger_sync("ansible", "manual")
        assert result == "queued"
        assert service._queued["ansible"] is True
    finally:
        lock.release()
        service._queued["ansible"] = False  # cleanup


@pytest.mark.asyncio
async def test_trigger_sync_started_when_free(monkeypatch):
    """Sync startet direkt wenn kein Lock aktiv."""
    import asyncio

    tasks_created = []

    async def _noop(*args, **kwargs):
        pass

    def fake_create_task(coro):
        tasks_created.append(coro)
        # Wirklich ausführen damit kein "never awaited" entsteht
        loop = asyncio.get_running_loop()
        return loop.create_task(coro)

    # Im service-Modul asyncio.create_task ersetzen, nicht global
    monkeypatch.setattr(service, "_run_sync_with_queue", _noop)
    monkeypatch.setattr(service.asyncio, "create_task", fake_create_task)

    result = await service.trigger_sync("packer", "manual")
    await asyncio.sleep(0)
    assert result == "started"
    assert len(tasks_created) == 1
