# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-35: Ausführungslogik für Scheduled Jobs (SSH, Power Action, Playbook).

Celery-Einstiegspunkt: run_job() – synchron.
Intern wird asyncio.run() für DB-Operationen verwendet.
SSH und Playbook laufen synchron via subprocess / ansible-runner.
Power Actions verwenden httpx.Client (synchron).
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

_OUTPUT_LIMIT = 51200  # 50 KB max output


# ── Synchroner Einstiegspunkt für Celery-Tasks ────────────────────────────────

def run_job(job_id: str, triggered_by: str = "scheduler") -> None:
    """Führt einen Scheduled Job aus. Synchroner Einstiegspunkt für Celery."""
    asyncio.run(_run_job_async(job_id, triggered_by))


# ── Async-Kern ────────────────────────────────────────────────────────────────

async def _run_job_async(job_id: str, triggered_by: str) -> None:
    from backend.db.database import init_db
    await init_db()

    from backend.plus.scheduled_jobs.service import (
        create_run, fail_run, finish_run, get_job, get_system_ssh_key,
    )

    job = await get_job(job_id)
    if not job:
        logger.warning("Scheduled job %s nicht gefunden", job_id)
        return

    config = job["config"]
    action = config.get("action") if job["job_type"] == "power_action" else None
    run_id = await create_run(job_id, triggered_by, action=action)

    try:
        output, exit_code = await _execute(job, config)
    except Exception as exc:
        logger.exception("Fehler beim Ausführen von Scheduled Job %s", job_id)
        await fail_run(run_id, job_id, str(exc))
        await _notify_on_failure(job, str(exc), exit_code=1)
        return

    await finish_run(run_id, job_id, output, exit_code)

    if exit_code != 0:
        await _notify_on_failure(job, output, exit_code=exit_code)


async def _execute(job: dict, config: dict) -> tuple[str, int]:
    """Dispatcht zur typ-spezifischen Ausführung. Gibt (output, exit_code) zurück."""
    jtype = job["job_type"]
    if jtype == "ssh":
        return await asyncio.get_event_loop().run_in_executor(None, _run_ssh, config)
    elif jtype == "playbook":
        # PROJ-49: Permission-Check vor dem Playbook-Run (AC-SJ-2)
        playbook_name = config.get("playbook", "")
        if playbook_name:
            try:
                from backend.services.local_auth import get_user_by_username
                from backend.services.permissions_resolver import can_user_execute_playbook
                from backend.services.audit_service import write_audit_log
                import json as _json
                owner = await get_user_by_username(job["created_by"])
                if owner is not None:
                    allowed = await can_user_execute_playbook(owner["id"], playbook_name)
                    if not allowed:
                        await write_audit_log(
                            "playbook_permission_denied",
                            username=job["created_by"],
                            detail=_json.dumps({
                                "playbook_name": playbook_name,
                                "actor": f"user:{owner['id']}",
                                "source": "scheduled_job",
                                "job_id": job["id"],
                            }),
                        )
                        return "[permission_denied] Playbook-Berechtigung fehlt – Job übersprungen", 1
            except Exception as exc:
                logger.warning("PROJ-49 Playbook-Permission-Check fehlgeschlagen: %s", exc)
        return await asyncio.get_event_loop().run_in_executor(None, _run_playbook, config, job["created_by"])
    elif jtype == "power_action":
        return await _run_power_action(config)
    elif jtype == "git_sync":
        return await _run_git_sync(config)
    else:
        return f"[error] Unbekannter Job-Typ: {jtype}", 1


# ── SSH-Ausführung ────────────────────────────────────────────────────────────

def _run_ssh(config: dict) -> tuple[str, int]:
    user_host: str = config.get("user_host", "")
    command: str = config.get("command", "")
    key_source: str = config.get("ssh_key_source", "system")
    timeout: int = int(config.get("timeout", 30))

    if not user_host or not command:
        return "[error] user_host und command sind Pflichtfelder", 1

    # Key aus DB holen (synchron über asyncio.run() nicht möglich hier, daher via run_in_executor)
    key_content = _get_key_sync(key_source, config)
    if key_content is None:
        return "[error] Kein SSH-Key verfügbar. Bitte System-Key oder Profil-Key konfigurieren.", 1

    tmp_path = Path(tempfile.gettempdir()) / f"sj_{uuid.uuid4().hex}.key"
    try:
        tmp_path.write_text(key_content)
        tmp_path.chmod(0o600)

        result = subprocess.run(
            [
                "ssh",
                "-i", str(tmp_path),
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", f"ConnectTimeout={timeout}",
                user_host,
                command,
            ],
            capture_output=True,
            text=True,
            timeout=timeout + 5,
        )
        combined = result.stdout + result.stderr
        return combined[:_OUTPUT_LIMIT], result.returncode
    except subprocess.TimeoutExpired:
        return f"[error] SSH-Verbindung Timeout nach {timeout} Sekunden", 255
    except FileNotFoundError:
        return "[error] ssh-Client nicht im Container verfügbar", 1
    except Exception as exc:
        return f"[error] SSH-Fehler: {exc}", 255
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def _get_key_sync(key_source: str, config: dict) -> str | None:
    """Holt den SSH-Key synchron (ruft asyncio.run() intern auf)."""
    return asyncio.run(_get_key_async(key_source, config))


async def _get_key_async(key_source: str, config: dict) -> str | None:
    if key_source == "system":
        from backend.plus.scheduled_jobs.service import get_system_ssh_key
        return await get_system_ssh_key()
    elif key_source == "profile":
        username: str = config.get("_created_by", "")
        if not username:
            return None
        from backend.services.profile_service import get_ssh_job_key_decrypted
        return await get_ssh_job_key_decrypted(username)
    return None


# ── Playbook-Ausführung ───────────────────────────────────────────────────────

def _run_playbook(config: dict, created_by: str) -> tuple[str, int]:
    """Führt ein Ansible-Playbook synchron via ansible-runner aus."""
    playbook: str = config.get("playbook", "")
    params: dict = config.get("params", {})

    if not playbook:
        return "[error] Kein Playbook angegeben", 1

    try:
        import ansible_runner  # type: ignore[import]
    except ImportError:
        return "[error] ansible-runner ist nicht installiert", 1

    from backend.core.config import settings
    ansible_dir = Path(settings.ansible_dir)

    # Node-Tokens synchron auflösen (via asyncio.run)
    extravars = asyncio.run(_build_playbook_vars(params, created_by))
    if extravars is None:
        return "[error] Kein Proxmox-Token für diesen Job konfiguriert", 1

    output_lines: list[str] = []

    def _event_handler(event: dict) -> None:
        stdout = event.get("stdout", "")
        if stdout:
            output_lines.append(stdout)

    try:
        playbook_file = f"{playbook}.yml"
        matches = list(ansible_dir.rglob(playbook_file))
        if not matches:
            return f"[error] Playbook '{playbook_file}' nicht gefunden in {ansible_dir}", 1
        playbook_dir = matches[0].parent

        with tempfile.TemporaryDirectory(prefix="p3_sj_") as work_dir:
            result = ansible_runner.run(
                private_data_dir=work_dir,
                project_dir=str(playbook_dir),
                playbook=playbook_file,
                extravars=extravars,
                event_handler=_event_handler,
                quiet=True,
                rotate_artifacts=1,
            )
        output = "\n".join(output_lines)[:_OUTPUT_LIMIT]
        return output, result.rc
    except Exception as exc:
        return f"[ansible error] {exc}", 1


async def _build_playbook_vars(params: dict, created_by: str) -> dict | None:
    """Baut extravars für Ansible analog zu ansible_runner_service._build_extravars."""
    from backend.services.ansible_runner_service import _build_extravars, _resolve_node_tokens

    proxmox_node_name: str | None = params.get("proxmox_node")
    host_override, tid_override, tsec_override = await _resolve_node_tokens(proxmox_node_name, "operator")

    if not (tid_override and tsec_override):
        return None

    return _build_extravars(
        params,
        user_role="operator",
        proxmox_credentials=None,
        proxmox_host_override=host_override,
        token_id_override=tid_override,
        token_secret_override=tsec_override,
    )


# ── Power-Action-Ausführung ───────────────────────────────────────────────────

async def _run_power_action(config: dict) -> tuple[str, int]:
    """Führt eine VM/LXC Power-Aktion via Proxmox API aus."""
    node: str = config.get("node", "")
    vmid: int = int(config.get("vmid", 0))
    vmtype: str = config.get("vmtype", "qemu")  # qemu | lxc
    action: str = config.get("action", "")

    if not all([node, vmid, action]):
        return "[error] node, vmid und action sind Pflichtfelder", 1

    _VALID_ACTIONS = {"start", "stop", "shutdown", "reboot", "suspend", "resume"}
    if action not in _VALID_ACTIONS:
        return f"[error] Ungültige Aktion: {action}", 1

    # Proxmox-Client über nodes-Tabelle
    try:
        from backend.services.service_accounts import get_node_tokens
        token, host_url, verify_ssl = await get_node_tokens(node, "admin")
    except Exception as exc:
        return f"[error] Node-Token nicht gefunden: {exc}", 1

    if token is None:
        return f"[error] Kein Admin-Token für Node '{node}' konfiguriert", 1

    vm_prefix = "qemu" if vmtype == "qemu" else "lxc"
    url = f"{host_url.rstrip('/')}/api2/json/nodes/{node}/{vm_prefix}/{vmid}/status/{action}"

    # PROJ-26-Konsistenz: per-Node ProxmoxClient mit dem verify_ssl-Wert aus der
    # nodes-Tabelle. Der globale proxmox_client würde den portal_config-Default
    # nutzen (typischerweise verify=True) und am Self-Signed-Cert scheitern,
    # sobald der Ziel-Node nicht der globale Default-Host ist.
    from backend.services.proxmox import ProxmoxClient
    import httpx
    try:
        node_client = ProxmoxClient(base_url=host_url, verify_ssl=verify_ssl)
        async with node_client._client() as client:
            headers = {
                "Authorization": f"PVEAPIToken={token.token_id}={token.token_secret}",
            }
            response = await client.post(url, headers=headers)

        if response.is_success:
            return f"Power-Aktion '{action}' auf {vmtype}/{vmid}@{node} erfolgreich.\n{response.text}", 0

        # Idempotenz: 500 mit "already running" / "not running" ist kein Fehler
        body = response.text.lower()
        if response.status_code == 500 and (
            "already running" in body or "not running" in body or "already stopped" in body
        ):
            return f"[idempotent] VM ist bereits im Zielzustand: {response.text}", 0

        return f"[error] Proxmox API {response.status_code}: {response.text}", 1

    except httpx.TimeoutException:
        return f"[error] Proxmox API Timeout für Node '{node}'", 1
    except Exception as exc:
        return f"[error] Proxmox API Fehler: {exc}", 1


# ── Fehler-Benachrichtigung ───────────────────────────────────────────────────

async def _notify_on_failure(job: dict, output: str, exit_code: int) -> None:
    """Sendet Webhook/E-Mail-Benachrichtigung bei fehlgeschlagenem Job."""
    try:
        from backend.services.settings_service import get_setting

        webhook_url = await get_setting("scheduled_jobs.webhook_url")
        email_recipients = await get_setting("scheduled_jobs.email_recipients")

        if not (webhook_url or email_recipients):
            return

        payload = {
            "job_id": job["id"],
            "job_name": job["name"],
            "job_type": job["job_type"],
            "exit_code": exit_code,
            "output_excerpt": output[:500],
            "timestamp": _now(),
        }

        if webhook_url:
            # PROJ-67 Phase 1 – F-002: use secure outbound client (no verify=False)
            from backend.core.http_client import secure_outbound_client
            try:
                async with secure_outbound_client(timeout=10.0) as client:
                    await client.post(webhook_url, json=payload)
            except Exception as exc:
                logger.warning("Scheduled Job Webhook fehlgeschlagen: %s", exc)

        if email_recipients:
            await _send_failure_email(job, payload, email_recipients)

    except Exception as exc:
        logger.warning("Benachrichtigung für Scheduled Job %s fehlgeschlagen: %s", job["id"], exc)


async def _send_failure_email(job: dict, payload: dict, recipients: str) -> None:
    from backend.services.settings_service import get_setting
    smtp_host = await get_setting("smtp.host")
    smtp_port_str = await get_setting("smtp.port")
    smtp_user = await get_setting("smtp.username")
    smtp_pass = await get_setting("smtp.password")
    smtp_from = await get_setting("smtp.from")

    if not smtp_host:
        return

    subject = f"[P3 Portal] Scheduled Job fehlgeschlagen: {job['name']}"
    body = (
        f"Job: {job['name']} (ID: {job['id']})\n"
        f"Typ: {job['job_type']}\n"
        f"Exit-Code: {payload['exit_code']}\n"
        f"Zeitstempel: {payload['timestamp']}\n\n"
        f"Output (erste 500 Zeichen):\n{payload['output_excerpt']}"
    )

    try:
        import aiosmtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = smtp_from or smtp_user or "p3portal@localhost"
        msg["To"] = recipients
        msg.set_content(body)

        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=int(smtp_port_str or 587),
            username=smtp_user or None,
            password=smtp_pass or None,
        )
    except Exception as exc:
        logger.warning("E-Mail-Benachrichtigung fehlgeschlagen: %s", exc)


async def _run_git_sync(config: dict) -> tuple[str, int]:
    """Führt einen Git-Sync für ansible, packer oder beide aus (PROJ-68)."""
    repo_type_cfg: str = config.get("repo_type", "both")
    repo_types: list[str]

    if repo_type_cfg == "both":
        repo_types = ["ansible", "packer"]
    elif repo_type_cfg in ("ansible", "packer"):
        repo_types = [repo_type_cfg]
    else:
        return f"[error] Ungültiger repo_type in git_sync-Konfiguration: {repo_type_cfg}", 1

    try:
        from backend.plus.git_sync import service as git_sync_service
    except ImportError:
        return "[error] Git-Sync ist ein Plus-Feature und nicht verfügbar", 1

    results: list[str] = []
    exit_code = 0

    for rt in repo_types:
        sync_status = await git_sync_service.trigger_sync(rt, triggered_by="scheduled_job")
        results.append(f"{rt}: {sync_status}")
        if sync_status not in ("started", "queued"):
            exit_code = 1

    return "\n".join(results), exit_code


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat()


# ── Asyncio-Fallback-Runner-Loop (kein Celery) ────────────────────────────────

async def _runner_loop() -> None:
    """Einfacher Asyncio-Runner als Celery-Fallback.

    Läuft als fire-and-forget Task im FastAPI-Lifespan.
    Prüft jede Minute auf fällige Jobs und führt sie aus.
    """
    import asyncio as _asyncio
    from backend.db.database import get_db
    from sqlalchemy import text as _text

    logger.info("PROJ-70: Asyncio Scheduled-Job-Runner-Loop gestartet (kein Celery)")
    while True:
        try:
            await _asyncio.sleep(60)
            from backend.plus.scheduled_jobs.service import get_due_jobs, advance_next_run
            from backend.core.plus_protocol import plus_behavior as _pb
            due = await get_due_jobs()
            if due:
                try:
                    blocked = await _pb.get_approval_blocked_scheduled_job_ids({j["id"] for j in due})
                except Exception:
                    blocked = set()
                due = [j for j in due if j["id"] not in blocked]
            for job in due:
                await advance_next_run(job["id"], job["cron_expression"])
                _asyncio.create_task(
                    _run_job_async(job["id"], "scheduler"),
                    name=f"sj_{job['id'][:8]}",
                )
        except _asyncio.CancelledError:
            logger.info("PROJ-70: Asyncio Runner-Loop beendet")
            return
        except Exception as exc:
            logger.warning("PROJ-70: Runner-Loop Fehler: %s", exc)
