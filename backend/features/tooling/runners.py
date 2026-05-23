# p3portal.org
"""PROJ-66: Subprocess-Wrapper für Ansible- und Packer-Health-Checks.

Beide Tools werden in zwei Phasen geprüft:
  1. --version / version → Version-String parsen
  2. Funktions-Probe     → exit-Code prüfen (ready vs. degraded)

Status-Ableitung (AC-CHECK-5):
  --version exit=0 + Probe exit=0 → ready
  --version exit=0 + Probe exit≠0 → degraded
  --version exit≠0 oder Timeout   → down

stdout/stderr werden auf _MAX_OUTPUT_BYTES (10 KB) je Sektion begrenzt (Tech-Design §E).
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import NamedTuple

logger = logging.getLogger(__name__)

_TIMEOUT = 10          # Sekunden pro Subprocess-Aufruf (AC-API-7)
_MAX_OUTPUT_BYTES = 10 * 1024  # 10 KB Cap pro Sektion (Tech-Design §E)


class CheckResult(NamedTuple):
    """Rohes Ergebnis eines Tool-Checks."""
    status: str        # "ready" | "degraded" | "down"
    version: str | None
    stdout: str        # kombiniert aus Version + Probe, mit Trennstrichen
    stderr: str        # kombiniert
    checked_at: datetime


def _cap(text: str) -> str:
    """Begrenzt stdout/stderr auf 10 KB (Byte-Ebene, UTF-8)."""
    encoded = text.encode("utf-8")
    if len(encoded) <= _MAX_OUTPUT_BYTES:
        return text
    return encoded[:_MAX_OUTPUT_BYTES].decode("utf-8", errors="replace") + "\n… (truncated)"


async def _run_cmd(cmd: list[str]) -> tuple[int, str, str]:
    """Führt einen Befehl async aus. Gibt (returncode, stdout, stderr) zurück.

    Bei TimeoutError → returncode=-1, stderr="timeout after 10s".
    Bei FileNotFoundError → returncode=-2, stderr="<cmd[0]>: command not found".
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=_TIMEOUT
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            return -1, "", f"timeout after {_TIMEOUT}s"

        stdout = _cap(stdout_b.decode("utf-8", errors="replace"))
        stderr = _cap(stderr_b.decode("utf-8", errors="replace"))
        return proc.returncode or 0, stdout, stderr

    except FileNotFoundError:
        return -2, "", f"{cmd[0]}: command not found"
    except Exception as exc:
        return -3, "", f"unexpected error: {exc}"


def _parse_ansible_version(stdout: str) -> str | None:
    """Extrahiert '2.18.1' aus 'ansible [core 2.18.1] ...'."""
    m = re.search(r"ansible\s+\[core\s+([\d.]+)\]", stdout)
    return m.group(1) if m else None


def _parse_packer_version(stdout: str) -> str | None:
    """Extrahiert '1.11.2' aus 'Packer v1.11.2'."""
    m = re.search(r"Packer\s+v?([\d.]+)", stdout, re.IGNORECASE)
    return m.group(1) if m else None


async def run_ansible_check() -> CheckResult:
    """Führt Ansible-Version + Funktions-Probe durch und liefert CheckResult."""
    now = datetime.now(timezone.utc)

    # Phase 1: --version
    ver_rc, ver_out, ver_err = await _run_cmd(["ansible", "--version"])
    if ver_rc < 0:
        combined_out = ""
        combined_err = ver_err
        return CheckResult(
            status="down",
            version=None,
            stdout=combined_out,
            stderr=combined_err,
            checked_at=now,
        )

    version = _parse_ansible_version(ver_out)

    # Phase 2: Funktions-Probe (AC-CHECK-3)
    probe_cmd = [
        "ansible", "all",
        "-i", "localhost,",
        "-m", "ping",
        "-c", "local",
        "--connection=local",
    ]
    probe_rc, probe_out, probe_err = await _run_cmd(probe_cmd)

    combined_out = _cap(
        f"=== ansible --version ===\n{ver_out}\n"
        f"=== ansible ping probe ===\n{probe_out}"
    )
    combined_err = _cap(
        f"=== ansible --version ===\n{ver_err}\n"
        f"=== ansible ping probe ===\n{probe_err}"
    )

    if probe_rc == 0:
        status = "ready"
    elif probe_rc < 0:
        # Timeout oder command-not-found in der Probe
        status = "down"
    else:
        status = "degraded"

    return CheckResult(
        status=status,
        version=version,
        stdout=combined_out,
        stderr=combined_err,
        checked_at=now,
    )


async def run_packer_check() -> CheckResult:
    """Führt Packer-Version + Funktions-Probe durch und liefert CheckResult."""
    now = datetime.now(timezone.utc)

    # Phase 1: version
    ver_rc, ver_out, ver_err = await _run_cmd(["packer", "version"])
    if ver_rc < 0:
        return CheckResult(
            status="down",
            version=None,
            stdout="",
            stderr=ver_err,
            checked_at=now,
        )

    version = _parse_packer_version(ver_out)

    # Phase 2: Funktions-Probe (AC-CHECK-4)
    probe_rc, probe_out, probe_err = await _run_cmd(["packer", "plugins", "installed"])

    combined_out = _cap(
        f"=== packer version ===\n{ver_out}\n"
        f"=== packer plugins installed ===\n{probe_out}"
    )
    combined_err = _cap(
        f"=== packer version ===\n{ver_err}\n"
        f"=== packer plugins installed ===\n{probe_err}"
    )

    if probe_rc == 0:
        status = "ready"
    elif probe_rc < 0:
        status = "down"
    else:
        status = "degraded"

    return CheckResult(
        status=status,
        version=version,
        stdout=combined_out,
        stderr=combined_err,
        checked_at=now,
    )
