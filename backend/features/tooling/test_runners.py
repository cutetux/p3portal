# p3portal.org
"""PROJ-66: Tests für runners.py (subprocess gemockt via AsyncMock)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.features.tooling.runners import (
    _parse_ansible_version,
    _parse_packer_version,
    run_ansible_check,
    run_packer_check,
)


# ── Version-Parsing ──────────────────────────────────────────────────────────

def test_parse_ansible_version_standard():
    txt = "ansible [core 2.18.1]\n  config file = None"
    assert _parse_ansible_version(txt) == "2.18.1"


def test_parse_ansible_version_no_match():
    assert _parse_ansible_version("some other output") is None


def test_parse_packer_version_standard():
    txt = "Packer v1.11.2\nYour version of Packer is out of date!"
    assert _parse_packer_version(txt) == "1.11.2"


def test_parse_packer_version_no_prefix():
    txt = "packer 1.9.0"
    assert _parse_packer_version(txt) == "1.9.0"


def test_parse_packer_version_no_match():
    assert _parse_packer_version("no version here") is None


# ── Ansible Runner – erfolgreich ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_ansible_check_ready():
    ver_stdout = b"ansible [core 2.18.1]\nconfig file = None\n"
    probe_stdout = b'localhost | SUCCESS => {"ping": "pong"}\n'

    async def fake_create(*args, **kwargs):
        cmd = list(args)
        proc = MagicMock()
        proc.returncode = 0
        if "ping" in cmd:
            proc.communicate = AsyncMock(return_value=(probe_stdout, b""))
        else:
            proc.communicate = AsyncMock(return_value=(ver_stdout, b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create):
        result = await run_ansible_check()

    assert result.status == "ready"
    assert result.version == "2.18.1"
    assert "ansible [core 2.18.1]" in result.stdout


@pytest.mark.asyncio
async def test_run_ansible_check_degraded_probe_fails():
    ver_stdout = b"ansible [core 2.18.1]\n"

    async def fake_create(*args, **kwargs):
        cmd = list(args)
        proc = MagicMock()
        if "ping" in cmd:
            proc.returncode = 2
            proc.communicate = AsyncMock(return_value=(b"", b"ERROR: host unreachable"))
        else:
            proc.returncode = 0
            proc.communicate = AsyncMock(return_value=(ver_stdout, b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create):
        result = await run_ansible_check()

    assert result.status == "degraded"
    assert result.version == "2.18.1"


@pytest.mark.asyncio
async def test_run_ansible_check_down_command_not_found():
    with patch(
        "asyncio.create_subprocess_exec",
        side_effect=FileNotFoundError("No such file"),
    ):
        result = await run_ansible_check()

    assert result.status == "down"
    assert result.version is None
    assert "command not found" in result.stderr


@pytest.mark.asyncio
async def test_run_ansible_check_timeout():
    async def fake_create(*args, **kwargs):
        proc = MagicMock()
        proc.kill = MagicMock()

        async def slow_communicate():
            await asyncio.sleep(999)

        proc.communicate = slow_communicate
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create):
        with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError):
            result = await run_ansible_check()

    assert result.status == "down"
    assert "timeout" in result.stderr


# ── Packer Runner ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_packer_check_ready():
    ver_stdout = b"Packer v1.11.2\n"
    probe_stdout = b"Installed Plugins:\n  packer-plugin-proxmox v1.2.0\n"

    async def fake_create(*args, **kwargs):
        cmd = list(args)
        proc = MagicMock()
        proc.returncode = 0
        if "plugins" in cmd:
            proc.communicate = AsyncMock(return_value=(probe_stdout, b""))
        else:
            proc.communicate = AsyncMock(return_value=(ver_stdout, b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create):
        result = await run_packer_check()

    assert result.status == "ready"
    assert result.version == "1.11.2"
    assert "packer-plugin-proxmox" in result.stdout


@pytest.mark.asyncio
async def test_run_packer_check_down_version_fails():
    with patch(
        "asyncio.create_subprocess_exec",
        side_effect=FileNotFoundError("No such file"),
    ):
        result = await run_packer_check()

    assert result.status == "down"
    assert result.version is None


# ── stdout-Cap ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_output_cap_applied():
    """Übergroße Ausgabe wird auf 10 KB begrenzt."""
    large_output = b"x" * 50_000  # 50 KB

    async def fake_create(*args, **kwargs):
        cmd = list(args)
        proc = MagicMock()
        proc.returncode = 0
        if "ping" in cmd or "plugins" in cmd:
            proc.communicate = AsyncMock(return_value=(b"", b""))
        else:
            proc.communicate = AsyncMock(return_value=(large_output, b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create):
        # Ansible
        result = await run_ansible_check()
    # Kombinierter stdout darf nicht > ~25 KB sein (2 Sektionen × 10 KB + Trennzeichen)
    assert len(result.stdout.encode("utf-8")) < 30_000
