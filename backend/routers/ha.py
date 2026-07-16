# p3portal.org
"""PROJ-103: Proxmox-HA-Verwaltung (HA-Gruppen / Ressourcen / Status / Laufzeit).

Manuelles CRUD auf dem Proxmox-HA-Stack über die Datacenter-API (`/cluster/ha/*`).
Zustand lebt vollständig in Proxmox (keine DB-Tabelle, SoT-Muster wie SDN,
PROJ-80). HA ist datacenter-weit **innerhalb EINER Proxmox-Installation**; der
optionale Query-Param `?node=<portal_node_id>` wählt die Ziel-Installation (ohne
ihn die Default-Node — Ein-Installations-Setups bleiben unverändert).

RBAC (Leitentscheidung /requirements #2):
  Read (Status/Gruppen/Ressourcen):  **viewer+** (require_not_restricted) — read-only.
  Write (CRUD + migrate/relocate):   Admin ODER `manage_ha` (`_assert_ha_access`).

Ausführung (Leitentscheidung #5): Config-CRUD **synchron** (schnelle Writes wie
SDN). Laufzeit-Aktionen `migrate`/`relocate` laufen über das **Job-System mit
Live-Log** (ha_action_service pollt den HA-Status der SID).

Cluster-Gating: HA-Endpoints antworten auf Standalone-/Nicht-HA-Installationen mit
`ha_unavailable`-Flag statt 500 (der Sidebar-Eintrag verschwindet frontendseitig
über /api/cluster/status). Fehler-Mapper `_ha_write_http_exc` wie SDN.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import text

from backend.core.deps import CurrentUser, get_current_user, require_not_restricted
from backend.db.database import get_db
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97
from backend.models.ha import (
    HaNodeStatus,
    HaResource,
    HaResourceListResponse,
    HaResourceWriteRequest,
    HaRule,
    HaRuleListResponse,
    HaRuleNode,
    HaRuleWriteRequest,
    HaRuntimeActionRequest,
    HaServiceStatus,
    HaStatusResponse,
    HaWriteResponse,
)
from backend.models.jobs import JobResponse
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ha", tags=["ha"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). GET → :read, Mutationen → :write.
_SCOPE_READ = Depends(require_scope_for_upk("ha:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("ha:write"))

# HTTP codes that signal "HA feature not available on this installation".
_HA_UNAVAILABLE_CODES = (404, 501)


# ── Error mapper ──────────────────────────────────────────────────────────────

def _ha_write_http_exc(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map Proxmox HA write-path errors (analog _sdn_write_http_exc).

    403 → 403 (missing HA privileges – the admin must know)
    401 → 502 (token invalid/deleted – stay logged in, Anti-Logout S115)
    else → pass status code through
    """
    code = exc.response.status_code
    if code == 403:
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient Proxmox privileges for HA management "
                   "(Sys.Console / HA privileges required on /cluster/ha)",
        )
    if code == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox auth error – admin service account token may be invalid or deleted",
        )
    return HTTPException(status_code=code, detail="Proxmox API error")


# ── RBAC gate ─────────────────────────────────────────────────────────────────

def _assert_ha_access(current_user: CurrentUser) -> None:
    """Allow Admin OR manage_ha (AC-RBAC-2). Raises 403 otherwise.

    Called first in every write endpoint. No node scope — HA is cluster-wide.
    Read endpoints do NOT call this (viewer+ may look, AC-RBAC-1).
    """
    if current_user.role == "admin":
        return
    if "manage_ha" in current_user.portal_permissions:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="ha_management_not_authorized",
    )


# ── Auth resolvers (per installation: selected portal node, else the default) ──

async def _resolve_ha_node(portal_node_id: int | None):
    """Resolve the target portal-node row (selected installation, else default)."""
    from backend.services.nodes_service import get_default_node, get_node
    node_row = await get_node(portal_node_id) if portal_node_id is not None else await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured" if portal_node_id is None
            else f"Portal node {portal_node_id} not found",
        )
    return node_row


async def _resolve_ha_read_auth(current_user: CurrentUser, portal_node_id: int | None = None):
    """Resolve the strongest available read token (admin→operator→viewer).

    Reading ``/cluster/ha/*`` requires more than a plain viewer token often
    carries (Sys.Audit). The HA view is read-only for viewer+ (AC-RBAC-1), so we
    pick the strongest read token of the target installation.
    """
    if current_user.auth_type == "proxmox":
        from backend.services.proxmox import ProxmoxAuth, proxmox_client
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        return proxmox_client, ProxmoxAuth(
            kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""),
        )

    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    node_row = await _resolve_ha_node(portal_node_id)
    token = (
        _extract_token(node_row, "admin")
        or _extract_token(node_row, "operator")
        or _extract_token(node_row, "viewer")
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No service-account token configured for this node",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


async def _resolve_ha_write_auth(current_user: CurrentUser, portal_node_id: int | None = None):
    """Resolve the admin write token (HA privileges) of the target installation."""
    if current_user.auth_type == "proxmox":
        from backend.services.proxmox import ProxmoxAuth, proxmox_client
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        return proxmox_client, ProxmoxAuth(
            kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""),
        )

    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    node_row = await _resolve_ha_node(portal_node_id)
    token = _extract_token(node_row, "admin")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin service account (HA privileges) not configured for this node",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


# ── Typesafe parsing (PVE version drift, Lehre PROJ-78/79/80) ─────────────────

def _s(value) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _i(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _b(value, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    try:
        return bool(int(value))
    except (TypeError, ValueError):
        return bool(value)


def _parse_rule_nodes(raw: str | None) -> list[HaRuleNode]:
    """Parse the PVE 'nodes' string 'pve1:100,pve2' into structured entries."""
    out: list[HaRuleNode] = []
    if not raw:
        return out
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            name, _, prio = part.partition(":")
            out.append(HaRuleNode(node=name.strip(), priority=_i(prio)))
        else:
            out.append(HaRuleNode(node=part, priority=None))
    return out


def _parse_resources_list(raw) -> list[str]:
    """Parse a PVE 'resources' value ('vm:100,ct:101' or list) into bare SIDs."""
    out: list[str] = []
    if raw is None:
        return out
    items = raw if isinstance(raw, list) else str(raw).split(",")
    for part in items:
        sid = str(part).strip()
        if sid.startswith("service:"):
            sid = sid[len("service:"):]
        if sid:
            out.append(sid)
    return out


def _parse_ha_rule(raw: dict) -> HaRule:
    if not isinstance(raw, dict):
        raw = {}
    nodes_raw = _s(raw.get("nodes"))
    resources_raw = raw.get("resources")
    return HaRule(
        id=_s(raw.get("rule")) or _s(raw.get("id")) or "",
        type=_s(raw.get("type")),
        resources=_parse_resources_list(resources_raw),
        resources_raw=_s(resources_raw) if not isinstance(resources_raw, list) else ",".join(_parse_resources_list(resources_raw)),
        nodes=_parse_rule_nodes(nodes_raw),
        nodes_raw=nodes_raw,
        strict=_b(raw.get("strict")),
        affinity=_s(raw.get("affinity")),
        comment=_s(raw.get("comment")),
        disable=_b(raw.get("disable")),
        digest=_s(raw.get("digest")),
    )


def _parse_ha_resource(raw: dict) -> HaResource:
    if not isinstance(raw, dict):
        raw = {}
    sid = _s(raw.get("sid")) or _s(raw.get("id")) or ""
    # PVE prefixes the id in status views with 'service:' — normalise to bare sid.
    if sid.startswith("service:"):
        sid = sid[len("service:"):]
    rtype = _s(raw.get("type"))
    if rtype is None and ":" in sid:
        rtype = sid.split(":", 1)[0]
    failback_raw = raw.get("failback")
    return HaResource(
        sid=sid,
        type=rtype,
        state=_s(raw.get("state")),
        max_restart=_i(raw.get("max_restart")),
        max_relocate=_i(raw.get("max_relocate")),
        failback=_b(failback_raw) if failback_raw is not None and failback_raw != "" else None,
        comment=_s(raw.get("comment")),
        digest=_s(raw.get("digest")),
    )


def _parse_status(entries: list[dict]) -> HaStatusResponse:
    """Derive quorum / manager / node / service info from status/current entries."""
    quorate: bool | None = None
    manager_node: str | None = None
    manager_status: str | None = None
    nodes: list[HaNodeStatus] = []
    resources: list[HaServiceStatus] = []

    for e in entries:
        if not isinstance(e, dict):
            continue
        etype = str(e.get("type", "")).lower()
        if etype == "quorum":
            q = e.get("quorate")
            if q is not None:
                quorate = _b(q)
            elif _s(e.get("status")):
                quorate = str(e.get("status")).upper() == "OK"
        elif etype == "master":
            manager_node = _s(e.get("node"))
            manager_status = _s(e.get("status"))
            if manager_node:
                nodes.append(HaNodeStatus(node=manager_node, type="master", status=manager_status))
        elif etype in ("lrm", "crm"):
            node = _s(e.get("node"))
            if node:
                nodes.append(HaNodeStatus(node=node, type=etype, status=_s(e.get("status"))))
        elif etype == "service":
            sid = _s(e.get("sid")) or _s(e.get("id")) or ""
            if sid.startswith("service:"):
                sid = sid[len("service:"):]
            resources.append(HaServiceStatus(
                sid=sid,
                state=_s(e.get("state")),
                node=_s(e.get("node")),
                crm_state=_s(e.get("crm_state")),
                request_state=_s(e.get("request_state")),
            ))
    return HaStatusResponse(
        quorate=quorate,
        manager_node=manager_node,
        manager_status=manager_status,
        nodes=nodes,
        resources=resources,
    )


def _proxmox_err_snippet(exc: httpx.HTTPStatusError) -> str:
    """Best-effort: extract a short, single-line snippet of the Proxmox error body.

    Proxmox packt die eigentliche Fehlerursache oft in den Response-Body (JSON
    ``errors``/``message`` oder HTML). Bei einem 5xx ist das der einzige Hinweis,
    warum der Aufruf scheiterte (z. B. fehlende Rechte, die als 500 statt 403
    zurückkommen). Für Diagnose ins Log + `detail` einblenden (gekürzt, entschärft).
    """
    try:
        raw = exc.response.text or ""
    except Exception:
        return ""
    try:
        payload = exc.response.json()
        if isinstance(payload, dict):
            msg = payload.get("message")
            errs = payload.get("errors")
            if errs and isinstance(errs, (dict, list)):
                raw = f"{msg or ''} {errs}".strip() if msg else str(errs)
            elif msg:
                raw = str(msg)
    except Exception:
        pass
    return " ".join(str(raw).split())[:300]


def _list_status_error(what: str, exc: httpx.HTTPStatusError, response_cls):
    """Map an HTTP status error on a read to the right flag (never 500)."""
    code = exc.response.status_code
    if code == 403:
        return response_cls(permission_denied=True)
    if code in _HA_UNAVAILABLE_CODES:
        return response_cls(ha_unavailable=True)
    snippet = _proxmox_err_snippet(exc)
    logger.warning("ha %s: Proxmox responded HTTP %s: %s", what, code, snippet or "<no body>")
    detail = f"Proxmox antwortete mit HTTP {code}"
    if snippet:
        detail += f": {snippet}"
    return response_cls(cluster_unreachable=True, detail=detail)


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=HaStatusResponse, dependencies=[_SCOPE_READ])
async def get_ha_status(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(require_not_restricted),
) -> HaStatusResponse:
    """Quorum + CRM/LRM manager status + per-resource states (AC-STATUS-1/2/3).

    Never 500 — availability flags instead (Standalone/permission/unreachable).
    """
    try:
        client, auth = await _resolve_ha_read_auth(current_user, node)
    except HTTPException as exc:
        return HaStatusResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("ha status: auth resolution failed: %r", exc)
        return HaStatusResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        entries = await client.get_ha_status_current(auth)
        return _parse_status(entries)
    except httpx.HTTPStatusError as exc:
        return _list_status_error("status", exc, HaStatusResponse)
    except httpx.RequestError as exc:
        logger.warning("ha status: connection failed: %r", exc)
        return HaStatusResponse(cluster_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("ha status: processing failed: %r", exc, exc_info=True)
        return HaStatusResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")


# ── Rules (PVE 9; replaces HA groups) ─────────────────────────────────────────

@router.get("/rules", response_model=HaRuleListResponse, dependencies=[_SCOPE_READ])
async def list_ha_rules(
    node: int | None = Query(None),
    type: str | None = Query(None, description="optional filter: node-affinity | resource-affinity"),
    current_user: CurrentUser = Depends(require_not_restricted),
) -> HaRuleListResponse:
    """List HA rules (node-affinity + resource-affinity). Never 500 (flags)."""
    try:
        client, auth = await _resolve_ha_read_auth(current_user, node)
    except HTTPException as exc:
        return HaRuleListResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("ha rules: auth resolution failed: %r", exc)
        return HaRuleListResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        raw = await client.get_ha_rules(auth, type)
        return HaRuleListResponse(items=[_parse_ha_rule(r) for r in raw])
    except httpx.HTTPStatusError as exc:
        return _list_status_error("rules", exc, HaRuleListResponse)
    except httpx.RequestError as exc:
        logger.warning("ha rules: connection failed: %r", exc)
        return HaRuleListResponse(cluster_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("ha rules: processing failed: %r", exc, exc_info=True)
        return HaRuleListResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")


@router.post("/rules", status_code=status.HTTP_201_CREATED, response_model=HaWriteResponse, dependencies=[_SCOPE_WRITE])
async def create_ha_rule(
    body: HaRuleWriteRequest,
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> HaWriteResponse:
    """Create an HA rule (node-affinity replaces groups; resource-affinity is new).

    409 on id collision.
    """
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)

    # Deterministic 409 pre-check (best-effort).
    try:
        existing = await client.get_ha_rules(auth)
        if any(isinstance(r, dict) and _s(r.get("rule")) == body.rule for r in existing):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"HA-Regel '{body.rule}' existiert bereits",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("ha rule create: collision pre-check failed: %r", exc)

    params = body.to_proxmox_params()
    params["rule"] = body.rule
    params["type"] = body.type
    try:
        await client.create_ha_rule(auth, params)
        await write_audit_log(
            event_type="ha_rule_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"rule={body.rule} type={body.type} resources={body._resources_param()}",
        )
        return HaWriteResponse(id=body.rule)
    except httpx.HTTPStatusError as exc:
        raise _ha_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/rules/{rule}", response_model=HaWriteResponse, dependencies=[_SCOPE_WRITE])
async def update_ha_rule(
    rule: str = Path(...),
    body: HaRuleWriteRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> HaWriteResponse:
    """Fully edit an HA rule (resources, nodes/strict or affinity, comment, disable)."""
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)
    params = body.to_proxmox_params(for_update=True)
    try:
        await client.update_ha_rule(auth, rule, params)
        await write_audit_log(
            event_type="ha_rule_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"rule={rule} type={body.type} resources={body._resources_param()}",
        )
        return HaWriteResponse(id=rule)
    except httpx.HTTPStatusError as exc:
        raise _ha_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/rules/{rule}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_ha_rule(
    rule: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete an HA rule. Removing a rule only drops the constraint — no resource
    is orphaned (unlike the old groups usage check, which therefore falls away)."""
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)
    try:
        await client.delete_ha_rule(auth, rule)
        await write_audit_log(
            event_type="ha_rule_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"rule={rule}",
        )
    except httpx.HTTPStatusError as exc:
        raise _ha_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Resources ──────────────────────────────────────────────────────────────────

@router.get("/resources", response_model=HaResourceListResponse, dependencies=[_SCOPE_READ])
async def list_ha_resources(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(require_not_restricted),
) -> HaResourceListResponse:
    """List HA resources (SID, Soll-Zustand, Gruppe, max_restart/relocate). Never 500."""
    try:
        client, auth = await _resolve_ha_read_auth(current_user, node)
    except HTTPException as exc:
        return HaResourceListResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("ha resources: auth resolution failed: %r", exc)
        return HaResourceListResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        raw = await client.get_ha_resources(auth)
        return HaResourceListResponse(items=[_parse_ha_resource(r) for r in raw])
    except httpx.HTTPStatusError as exc:
        return _list_status_error("resources", exc, HaResourceListResponse)
    except httpx.RequestError as exc:
        logger.warning("ha resources: connection failed: %r", exc)
        return HaResourceListResponse(cluster_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("ha resources: processing failed: %r", exc, exc_info=True)
        return HaResourceListResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")


@router.post("/resources", status_code=status.HTTP_201_CREATED, response_model=HaWriteResponse, dependencies=[_SCOPE_WRITE])
async def create_ha_resource(
    body: HaResourceWriteRequest,
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> HaWriteResponse:
    """Add a VM/CT as an HA resource (AC-RES-1). 409 if already HA-managed (AC-RES-5)."""
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)

    # Deterministic 409 pre-check for double-add (AC-RES-5, best-effort).
    try:
        existing = await client.get_ha_resources(auth)
        for r in existing:
            if not isinstance(r, dict):
                continue
            rsid = _s(r.get("sid")) or ""
            if rsid.startswith("service:"):
                rsid = rsid[len("service:"):]
            if rsid == body.sid:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"{body.sid} ist bereits eine HA-Ressource",
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("ha resource create: collision pre-check failed: %r", exc)

    params = body.to_proxmox_params()
    params["sid"] = body.sid
    try:
        await client.create_ha_resource(auth, params)
        await write_audit_log(
            event_type="ha_resource_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"sid={body.sid} state={body.state}",
        )
        return HaWriteResponse(id=body.sid)
    except httpx.HTTPStatusError as exc:
        raise _ha_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/resources/{sid}", response_model=HaWriteResponse, dependencies=[_SCOPE_WRITE])
async def update_ha_resource(
    sid: str = Path(...),
    body: HaResourceWriteRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> HaWriteResponse:
    """Edit an HA resource (Soll-Zustand, max_restart/relocate, Gruppe, Kommentar — AC-RES-2/3)."""
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)
    params = body.to_proxmox_params(for_update=True)
    try:
        await client.update_ha_resource(auth, sid, params)
        await write_audit_log(
            event_type="ha_resource_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"sid={sid} state={body.state}",
        )
        return HaWriteResponse(id=sid)
    except httpx.HTTPStatusError as exc:
        raise _ha_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/resources/{sid}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_ha_resource(
    sid: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Remove a VM/CT from HA management (AC-RES-4). Back to manual operation."""
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)
    try:
        await client.delete_ha_resource(auth, sid)
        await write_audit_log(
            event_type="ha_resource_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"sid={sid}",
        )
    except httpx.HTTPStatusError as exc:
        raise _ha_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Runtime actions (Job-System + Live-Log, AC-ACT-1/2/3) ─────────────────────

async def _installation_nodes(node_row) -> set[str]:
    """All PVE node names of one installation = proxmox_node + cluster_nodes (PROJ-101)."""
    names = {node_row.proxmox_node} if node_row.proxmox_node else set()
    names.update(n for n in (node_row.cluster_nodes or []) if n)
    return names


async def _create_ha_action_job(
    action: str,
    current_user: CurrentUser,
    sid: str,
    target_node: str,
    client,
    auth,
) -> JobResponse:
    """Persist an HA runtime job and dispatch the async worker (Muster _create_lifecycle_job)."""
    from backend.services.ha_action_service import run_ha_action_job

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    job_type = f"ha_{action}"
    playbook_label = f"{action}:{sid}→{target_node}"
    params = {"sid": sid, "target_node": target_node, "action": action}
    async with get_db() as session:
        await session.execute(
            text(
                "INSERT INTO jobs (id, type, playbook, status, created_at, username, params) "
                "VALUES (:id, :jtype, :pb, 'pending', :now, :user, :params)"
            ),
            {
                "id": job_id, "jtype": job_type, "pb": playbook_label,
                "now": now, "user": current_user.username, "params": json.dumps(params),
            },
        )
        await session.commit()

    asyncio.create_task(run_ha_action_job(
        job_id, action, client, auth, sid, target_node,
        actor_username=current_user.username,
    ))
    return JobResponse(
        id=job_id, type=job_type, playbook=playbook_label, status="pending",
        created_at=now, username=current_user.username, params=params,
    )


async def _run_ha_runtime_action(
    action: str, sid: str, body: HaRuntimeActionRequest,
    node: int | None, current_user: CurrentUser,
) -> JobResponse:
    """Shared body for migrate/relocate: validate target, then start a job."""
    _assert_ha_access(current_user)
    client, auth = await _resolve_ha_write_auth(current_user, node)

    # Ziel-Node muss zur Installation gehören (AC-ACT-3). Gleiche Node abfangen.
    try:
        node_row = await _resolve_ha_node(node)
        valid = await _installation_nodes(node_row)
    except HTTPException:
        raise
    except Exception:
        valid = set()
    if valid and body.node not in valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{body.node}' ist keine gültige Node dieser Installation",
        )

    # Gleiche Node = aktuelle Node der Ressource? best-effort aus dem HA-Status.
    try:
        entries = await client.get_ha_status_current(auth)
        current_node = None
        for e in entries:
            esid = _s(e.get("sid")) or _s(e.get("id")) or ""
            if esid.startswith("service:"):
                esid = esid[len("service:"):]
            if str(e.get("type", "")).lower() == "service" and esid == sid:
                current_node = _s(e.get("node"))
                break
        if current_node and current_node == body.node:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Ressource läuft bereits auf Node '{body.node}'",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("ha %s: current-node lookup failed for %s: %r", action, sid, exc)

    return await _create_ha_action_job(action, current_user, sid, body.node, client, auth)


@router.post("/resources/{sid}/migrate", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
async def migrate_ha_resource(
    sid: str = Path(...),
    body: HaRuntimeActionRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Live-migrate an HA resource to another node (job + live-log, AC-ACT-1/2)."""
    return await _run_ha_runtime_action("migrate", sid, body, node, current_user)


@router.post("/resources/{sid}/relocate", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
async def relocate_ha_resource(
    sid: str = Path(...),
    body: HaRuntimeActionRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Relocate (stop+start elsewhere) an HA resource to another node (job + live-log)."""
    return await _run_ha_runtime_action("relocate", sid, body, node, current_user)
