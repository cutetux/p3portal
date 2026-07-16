# p3portal.org
"""PROJ-103: Job-Worker für HA-Laufzeit-Aktionen (migrate / relocate).

Anders als die PROJ-102-Lebenszyklus-Jobs (die einen Proxmox-Task-UPID tailen)
**enqueued** eine HA-Aktion nur ein CRM-Kommando – Proxmox liefert **keinen
Task-UPID**. Der HA-Manager führt die Verschiebung asynchron aus. Dieser Worker

1. löst das CRM-Kommando aus (``proxmox.ha_migrate_resource`` / ``ha_relocate_resource``),
2. **pollt danach den HA-Status** der SID (`/cluster/ha/status/current`) und
   schreibt Fortschrittszeilen (Node-/Zustandswechsel) ins Job-Logfile,
3. gilt als erfolgreich, sobald die Ressource auf der Ziel-Node in einem stabilen
   Zustand angekommen ist (bzw. failed bei Timeout / Proxmox-Fehler).

Das Logfile ``data/logs/{job_id}.log`` wird vom bestehenden WebSocket-Log-Viewer
(``backend/routers/jobs.py``) live getailt – identisch zu PROJ-102. Die Job-Helper
(``_LogFile`` / ``_set_running`` / ``_set_finished`` / ``_job_cancelled``) werden aus
``vm_lifecycle_service`` wiederverwendet, um DRY zu bleiben.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from backend.services.audit_service import write_audit_log
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
from backend.services.vm_lifecycle_service import (
    _LogFile,
    _job_cancelled,
    _set_finished,
    _set_running,
)

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 3.0
_MAX_POLLS = 200  # ~10 min ceiling
# HA-Zustände, die als "angekommen/stabil" gelten (nicht transitorisch).
_STABLE_STATES = {"started", "stopped", "disabled", "ignored"}
_TRANSIENT_STATES = {"migrate", "relocate", "starting", "stopping", "request_start", "request_stop"}


def _humanize_proxmox_error(exc: httpx.HTTPStatusError, action: str) -> str:
    code = exc.response.status_code
    if code == 403:
        return (
            f"[error] {action}: Proxmox lehnte die Aktion ab (403). Dem Admin-Token "
            "fehlen vermutlich die HA-Verwaltungsrechte auf /cluster/ha."
        )
    if code == 400:
        detail = ""
        try:
            detail = str(exc.response.text)[:300]
        except Exception:
            detail = ""
        return f"[error] {action}: Proxmox lehnte die Aktion ab (400). {detail}".rstrip()
    detail = ""
    try:
        detail = str(exc.response.text)[:300]
    except Exception:
        detail = ""
    return f"[error] {action}: Proxmox API Fehler {code}. {detail}".rstrip()


def _current_service(entries: list[dict], sid: str) -> dict | None:
    """Find the status/current 'service' entry for *sid* (tolerant of 'service:' prefix)."""
    for e in entries:
        if not isinstance(e, dict):
            continue
        if str(e.get("type", "")).lower() != "service":
            continue
        esid = str(e.get("sid") or e.get("id") or "")
        if esid.startswith("service:"):
            esid = esid[len("service:"):]
        if esid == sid:
            return e
    return None


async def _poll_until_arrived(
    log: _LogFile, client: ProxmoxClient, auth: ProxmoxAuth,
    sid: str, target_node: str, job_id: str,
) -> bool:
    """Poll the HA status until *sid* is stable on *target_node*. Returns success."""
    last_node: str | None = None
    last_state: str | None = None
    for _ in range(_MAX_POLLS):
        if await _job_cancelled(job_id):
            log.write("[abbruch] Job wurde abgebrochen.")
            return False
        try:
            entries = await client.get_ha_status_current(auth)
        except Exception as exc:  # transienter Status-Fehler → weiter pollen
            logger.debug("PROJ-103: HA status poll error (%s): %s", sid, exc)
            await asyncio.sleep(_POLL_INTERVAL_S)
            continue

        svc = _current_service(entries, sid)
        if svc is None:
            log.write(f"[hinweis] HA-Ressource {sid} nicht (mehr) im Status gefunden.")
            await asyncio.sleep(_POLL_INTERVAL_S)
            continue

        node = str(svc.get("node") or "")
        state = str(svc.get("state") or "")
        if node != last_node or state != last_state:
            log.write(f"[info] Status: Node={node or '?'} Zustand={state or '?'}")
            last_node, last_state = node, state

        if node == target_node and state not in _TRANSIENT_STATES:
            if state in _STABLE_STATES or state == "":
                log.write(f"[status] Ressource {sid} ist auf Node '{target_node}' angekommen (Zustand: {state or 'n/a'}).")
                return True
        if state == "error":
            log.write(f"[error] HA-Ressource {sid} ist im Fehlerzustand.")
            return False
        await asyncio.sleep(_POLL_INTERVAL_S)

    log.write("[error] Zeitüberschreitung beim Warten auf den HA-Manager.")
    return False


async def run_ha_action_job(
    job_id: str,
    action: str,
    client: ProxmoxClient,
    auth: ProxmoxAuth,
    sid: str,
    target_node: str,
    *,
    actor_username: str,
) -> None:
    """Background-Task: HA-migrate/relocate auslösen + Fortschritt live protokollieren."""
    log = _LogFile(job_id)
    await _set_running(job_id, str(log.path))

    label = {"migrate": "HA-Migration", "relocate": "HA-Relocate"}.get(action, action)
    log.write(f"[info] {label} gestartet für {sid} → Node '{target_node}'.")

    ok = False
    try:
        if action == "migrate":
            await client.ha_migrate_resource(auth, sid, target_node)
        elif action == "relocate":
            await client.ha_relocate_resource(auth, sid, target_node)
        else:
            log.write(f"[error] Unbekannte HA-Aktion: {action}")
            await _set_finished(job_id, False)
            return
        log.write("[info] CRM-Kommando eingereiht – warte auf den HA-Manager …")
        ok = await _poll_until_arrived(log, client, auth, sid, target_node, job_id)
    except httpx.HTTPStatusError as exc:
        log.write(_humanize_proxmox_error(exc, label))
        ok = False
    except httpx.RequestError as exc:
        log.write(f"[error] {label}: Proxmox API nicht erreichbar ({exc}).")
        ok = False
    except Exception as exc:  # noqa: BLE001 – letzte Sicherung, Job darf nie hängen
        logger.exception("PROJ-103: HA action job %s (%s) crashed", job_id, action)
        log.write(f"[error] {label}: unerwarteter Fehler ({exc}).")
        ok = False

    log.write(f"[status] {label} {'erfolgreich abgeschlossen' if ok else 'fehlgeschlagen'}.")
    await _set_finished(job_id, ok)
    try:
        await write_audit_log(
            event_type=f"ha_{action}",
            username=actor_username,
            auth_type="local",
            detail=f"sid={sid} target={target_node} → {'ok' if ok else 'failed'}",
        )
    except Exception:
        pass
