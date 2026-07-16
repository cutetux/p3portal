# p3portal.org
"""PROJ-102: Job-Worker für VM/LXC-Lebenszyklus-Aktionen (Clone/Migrate/Convert).

Jede Aktion (Clone · Migrate · Convert-to-Template) läuft als eigener Job über die
bestehende ``jobs``-Tabelle + das Logfile ``data/logs/{job_id}.log``, das der
bestehende WebSocket-Log-Viewer (``backend/routers/jobs.py``) live tailt. Der Worker

1. startet die generische Core-Client-Operation (``proxmox.clone_vm`` / ``migrate_vm`` /
   ``convert_to_template``) → Proxmox-Task-UPID (leer bei synchronem Convert),
2. pollt Task-Status + Task-Log und schreibt fortlaufend nutzerlesbare Zeilen ins Log,
3. setzt Job-Status ``success``/``failed`` + meldet Proxmox-Fehler nutzerlesbar,
4. vergibt (Clone) bzw. entfernt (Convert) den Owner-Eintrag (PROJ-48).

Wird als ``asyncio.create_task`` aus den vms.py-Endpoints dispatcht (gleicher In-Process-
Pattern wie ``run_ansible_job`` / Stacks-Deploy). ``client`` + ``auth`` sind bereits vom
Endpoint per-Node aufgelöst und werden hier nur wiederverwendet.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db
from backend.services.audit_service import write_audit_log
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 2.0
_MAX_POLLS = 3600  # ~2h ceiling für Clone/Migrate großer Disks


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _humanize_proxmox_error(exc: httpx.HTTPStatusError, action: str) -> str:
    """Nutzerlesbare Meldung für einen Proxmox-HTTP-Fehler (AC-JOB-2)."""
    code = exc.response.status_code
    if code == 403:
        return (
            f"[error] {action}: Proxmox lehnte die Aktion ab (403). Dem Admin-Token "
            "fehlen vermutlich die nötigen Rechte (VM.Clone / VM.Allocate / "
            "VM.Config.* / Datastore.AllocateSpace / VM.Migrate)."
        )
    detail = ""
    try:
        detail = str(exc.response.text)[:300]
    except Exception:
        detail = ""
    return f"[error] {action}: Proxmox API Fehler {code}. {detail}".rstrip()


class _LogFile:
    """Kleiner append-only Log-Writer für das Job-Logfile."""

    def __init__(self, job_id: str) -> None:
        log_dir = Path(settings.data_dir) / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        self.path = log_dir / f"{job_id}.log"
        # Frisch anlegen (überschreibt evtl. Reste eines wiederverwendeten Namens).
        self.path.write_text("")

    def write(self, line: str) -> None:
        with self.path.open("a") as f:
            f.write(line.rstrip("\n") + "\n")


async def _set_running(job_id: str, log_path: str) -> None:
    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status='running', started_at=:ts, log_path=:lp WHERE id=:id"),
            {"ts": _now(), "lp": log_path, "id": job_id},
        )
        await session.commit()


async def _set_finished(job_id: str, ok: bool) -> None:
    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status=:st, finished_at=:ts WHERE id=:id"),
            {"st": "success" if ok else "failed", "ts": _now(), "id": job_id},
        )
        await session.commit()


async def _job_cancelled(job_id: str) -> bool:
    """True wenn der Job extern (Cancel-Endpoint) auf failed gesetzt wurde."""
    async with get_db() as session:
        row = (await session.execute(
            text("SELECT status FROM jobs WHERE id=:id"), {"id": job_id}
        )).mappings().fetchone()
    return row is None or row["status"] == "failed"


async def _tail_task(
    log: _LogFile, client: ProxmoxClient, auth: ProxmoxAuth,
    node: str, upid: str, job_id: str,
) -> bool:
    """Pollt einen Proxmox-Task bis Ende, tailt sein Log. Gibt success zurück."""
    seen = 0
    for _ in range(_MAX_POLLS):
        if await _job_cancelled(job_id):
            log.write("[abbruch] Job wurde abgebrochen.")
            return False
        # Neue Log-Zeilen anhängen
        lines = await client.get_task_log(auth, node, upid, start=seen, limit=500)
        for entry in lines:
            txt = entry.get("t")
            if txt is not None:
                log.write(str(txt))
        seen += len(lines)

        try:
            st = await client.get_task_status(auth, node, upid)
        except Exception as exc:  # transienter Status-Fehler → weiter pollen
            logger.debug("PROJ-102: task status poll error (%s): %s", upid, exc)
            await asyncio.sleep(_POLL_INTERVAL_S)
            continue

        if st.get("status") == "stopped":
            # Restliche Log-Zeilen einsammeln
            lines = await client.get_task_log(auth, node, upid, start=seen, limit=500)
            for entry in lines:
                txt = entry.get("t")
                if txt is not None:
                    log.write(str(txt))
            exit_status = st.get("exitstatus")
            ok = exit_status == "OK"
            if not ok:
                log.write(f"[error] Proxmox-Task endete mit: {exit_status}")
            return ok
        await asyncio.sleep(_POLL_INTERVAL_S)

    log.write("[error] Zeitüberschreitung beim Warten auf den Proxmox-Task.")
    return False


async def _portal_node_id(pve_node: str) -> int | None:
    from backend.services.nodes_service import get_node_for_proxmox_name
    row = await get_node_for_proxmox_name(pve_node)
    return row.id if row else None


async def _assign_clone_owner(
    log: _LogFile, pve_node: str, new_vmid: int, vm_type: str,
    actor_user_id: int, actor_username: str,
) -> None:
    """Trägt den auslösenden Nutzer als Owner der Klon-Kopie ein (AC-CLONE-3).

    Limit erreicht → Clone bleibt erfolgreich, kein Owner, Hinweis im Log (AC-CLONE-3b).
    """
    node_id = await _portal_node_id(pve_node)
    if node_id is None:
        log.write("[hinweis] Owner-Eintrag übersprungen: Portal-Node nicht ermittelbar.")
        return
    resource_type = "lxc" if vm_type == "lxc" else "vm"
    from backend.features.owners.service import (
        DuplicateOwnerError,
        LimitExceededError,
        add_owner,
    )
    try:
        await add_owner(
            resource_type, node_id, new_vmid, actor_user_id,
            actor_user_id, source="clone", actor_username=actor_username,
        )
        log.write(f"[info] Owner gesetzt: {actor_username} → {resource_type} {new_vmid}.")
    except LimitExceededError:
        log.write(
            "[hinweis] Owner-Limit erreicht – der Klon wurde ohne Auto-Owner erstellt."
        )
    except DuplicateOwnerError:
        pass
    except Exception as exc:
        logger.warning("PROJ-102: clone owner assign failed: %s", exc)
        log.write("[hinweis] Owner-Eintrag konnte nicht gesetzt werden.")


async def _remove_template_owner(
    log: _LogFile, pve_node: str, vmid: int, vm_type: str, actor_username: str,
) -> None:
    """Entfernt evtl. Owner-Einträge – ein Template hat keinen Owner (AC-TMPL-4)."""
    node_id = await _portal_node_id(pve_node)
    if node_id is None:
        return
    resource_type = "lxc" if vm_type == "lxc" else "vm"
    try:
        async with get_db() as db:
            await db.execute(
                text("""
                    UPDATE vm_owners
                       SET deleted_at = :now, deleted_reason = 'converted_to_template'
                     WHERE resource_type = :rt AND node_id = :nid AND vmid = :vmid
                       AND deleted_at IS NULL
                """),
                {"now": _now(), "rt": resource_type, "nid": node_id, "vmid": vmid},
            )
            await db.commit()
    except Exception as exc:
        logger.warning("PROJ-102: template owner cleanup failed: %s", exc)


async def run_vm_lifecycle_job(
    job_id: str,
    action: str,
    client: ProxmoxClient,
    auth: ProxmoxAuth,
    pve_node: str,
    vmid: int,
    vm_type: str,
    *,
    actor_username: str,
    actor_user_id: int | None = None,
    # clone
    newid: int | None = None,
    name: str | None = None,
    target_storage: str | None = None,
    full: bool = True,
    set_owner: bool = False,
    # migrate
    target_node: str | None = None,
) -> None:
    """Background-Task: führt eine Lebenszyklus-Aktion aus + protokolliert live."""
    log = _LogFile(job_id)
    await _set_running(job_id, str(log.path))

    label = {"clone": "Clone", "migrate": "Migrate", "template": "Convert-to-Template"}.get(
        action, action
    )
    log.write(f"[info] {label} gestartet für {vm_type} {vmid} auf Node {pve_node}.")

    ok = False
    try:
        if action == "clone":
            log.write(
                f"[info] Ziel-VMID {newid}, Name '{name}', "
                f"Storage '{target_storage or 'default'}', "
                f"{'Full-Clone' if full else 'Linked-Clone'}."
            )
            upid = await client.clone_vm(
                auth, pve_node, vmid, int(newid), name=name,
                target_storage=target_storage, full=full, vm_type=vm_type,
            )
        elif action == "migrate":
            log.write(
                f"[info] Offline-Migration nach Node '{target_node}', "
                f"Ziel-Storage '{target_storage or 'unverändert'}'."
            )
            upid = await client.migrate_vm(
                auth, pve_node, vmid, str(target_node),
                target_storage=target_storage, vm_type=vm_type,
            )
        elif action == "template":
            log.write("[info] Konvertiere zu Template …")
            upid = await client.convert_to_template(auth, pve_node, vmid, vm_type)
        else:
            log.write(f"[error] Unbekannte Aktion: {action}")
            await _set_finished(job_id, False)
            return

        if upid:
            ok = await _tail_task(log, client, auth, pve_node, upid, job_id)
        else:
            # Synchroner Aufruf (Convert) ohne Fehler → Erfolg.
            ok = True
    except httpx.HTTPStatusError as exc:
        log.write(_humanize_proxmox_error(exc, label))
        ok = False
    except httpx.RequestError as exc:
        log.write(f"[error] {label}: Proxmox API nicht erreichbar ({exc}).")
        ok = False
    except Exception as exc:  # noqa: BLE001 – letzte Sicherung, Job darf nie hängen
        logger.exception("PROJ-102: lifecycle job %s (%s) crashed", job_id, action)
        log.write(f"[error] {label}: unerwarteter Fehler ({exc}).")
        ok = False

    # Post-Success-Hooks (Owner)
    if ok:
        if action == "clone" and set_owner and actor_user_id is not None and newid is not None:
            await _assign_clone_owner(
                log, pve_node, int(newid), vm_type, actor_user_id, actor_username
            )
        elif action == "template":
            await _remove_template_owner(log, pve_node, vmid, vm_type, actor_username)
        log.write(f"[status] {label} erfolgreich abgeschlossen.")
    else:
        log.write(f"[status] {label} fehlgeschlagen.")

    await _set_finished(job_id, ok)
    try:
        await write_audit_log(
            event_type=f"vm_{action}",
            username=actor_username,
            auth_type="local",
            detail=f"{vm_type} {vmid} on {pve_node} → {'ok' if ok else 'failed'}"
                   + (f" (newid={newid})" if action == "clone" else "")
                   + (f" (target={target_node})" if action == "migrate" else ""),
        )
    except Exception:
        pass
