# p3portal.org
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import NoReturn

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import text
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.db.database import get_db
from backend.models.jobs import JobResponse
from backend.models.vms import (
    CloneRequest,
    DiskAttachRequest,
    DiskListResponse,
    DiskResizeRequest,
    ImageStorageInfo,
    MigrateRequest,
    MigrationTargetsResponse,
    RootdirStorageInfo,
    ServiceAccountStatusResponse,
    SnapshotCreateRequest,
    SnapshotInfo,
    VmConfigUpdateRequest,
    VmTaskResponse,
)
from backend.services.audit_service import write_audit_log
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient, proxmox_client
from backend.services.service_accounts import _extract_token, get_service_account_status
from backend.services.permissions_resolver import resolve_user_permissions
from backend.services.local_auth import get_user_by_username

router = APIRouter(prefix="/api", tags=["vms"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). VM-Reads → cluster:read, Mutationen → vms:write.
_SCOPE_READ = Depends(require_scope_for_upk("cluster:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("vms:write"))


async def _assert_not_stack_managed(pve_node: str, vmid: int, username: str, auth_type: str) -> None:
    """Block single-VM mutations on stack-managed VMs (PROJ-76 Phase 2b, AC-2B-MUT-6).

    Serverside enforcement: CPU/RAM/Disk/Delete on a VM tracked by a stack state
    must go through the stack definition. Core-mode is a no-op (Plus-Hook → None).
    Power actions and snapshots are intentionally NOT guarded.
    """
    from backend.core.plus_protocol import plus_behavior
    from backend.services.nodes_service import get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(pve_node)
    if node_row is None:
        return
    try:
        managed = await plus_behavior.get_stack_for_vm(node_row.id, vmid)
    except Exception:
        managed = None
    if managed:
        await write_audit_log(
            event_type="stack_vm_mutation_blocked",
            username=username,
            auth_type=auth_type,
            detail=f"vmid={vmid} node={pve_node} stack_id={managed['stack_id']}",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "vm_managed_by_stack",
                "stack_id": managed["stack_id"],
                "stack_name": managed["stack_name"],
            },
        )


async def _dependency_impact(
    pve_node: str, vmid: int, confirm: bool, action: str,
    username: str, auth_type: str,
) -> None:
    """PROJ-96: warn-then-confirm guard for actions on a VM others depend on.

    Structurally analog to ``_assert_not_stack_managed`` (a Plus-hook lookup +
    409), but **resumable**: if dependents exist and ``confirm`` is False, raise
    409 ``dependency_impact`` with the list of direct dependents. A retry with
    ``?confirm=true`` skips the guard and runs the original action (warnen, nicht
    blockieren — PROJ-96 decision #2). Core-mode is a no-op (Plus-Hook → []).
    Wired into stop/reboot/rollback/delete; start is intentionally NOT guarded.
    Not permission-gated (AC-IMPACT-5) — any user allowed to run the action gets
    the warning.
    """
    if confirm:
        return
    from backend.core.plus_protocol import plus_behavior
    from backend.services.nodes_service import get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(pve_node)
    if node_row is None:
        return
    try:
        dependents = await plus_behavior.get_dependents_of_vm(node_row.id, vmid)
    except Exception:
        dependents = []
    if not dependents:
        return
    await write_audit_log(
        event_type="vm_dependency_impact_warned",
        username=username,
        auth_type=auth_type,
        detail=f"vmid={vmid} node={pve_node} action={action} dependents={len(dependents)}",
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "dependency_impact",
            "action": action,
            "count": len(dependents),
            "dependents": dependents,
        },
    )


async def _ipam_release_impact(
    pve_node: str, vmid: int, confirm: bool,
    username: str, auth_type: str,
) -> None:
    """PROJ-42 Phase 2: warn-then-confirm guard when deleting a VM holding an IPAM
    allocation.

    Structurally analog to ``_dependency_impact`` (Plus-hook lookup + resumable
    409): if the VM holds a confirmed/orphaned IP allocation and ``confirm`` is
    False, raise 409 ``ipam_allocation_impact`` listing the IPs that would be
    released. A retry with ``?confirm=true`` skips the guard; the release itself
    happens via ``on_vm_lxc_deleted_ipam`` after the delete. Core-mode is a no-op
    (Plus-Hook → []). Not permission-gated (any user allowed to delete gets it).
    """
    if confirm:
        return
    from backend.core.plus_protocol import plus_behavior
    from backend.services.nodes_service import get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(pve_node)
    if node_row is None:
        return
    try:
        allocations = await plus_behavior.ipam_release_impact(node_row.id, vmid)
    except Exception:
        allocations = []
    if not allocations:
        return
    await write_audit_log(
        event_type="ipam_release_impact_warned",
        username=username,
        auth_type=auth_type,
        detail=f"vmid={vmid} node={pve_node} allocations={len(allocations)}",
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "ipam_allocation_impact",
            "count": len(allocations),
            "allocations": allocations,
        },
    )


async def _assert_ha_confirmed(
    client: ProxmoxClient, auth: ProxmoxAuth, vmid: int, confirm: bool,
    action: str, username: str, auth_type: str,
) -> None:
    """PROJ-103: warn-then-confirm guard for actions on an HA-managed VM/CT.

    Structurally analog to ``_dependency_impact`` (a lookup + resumable 409), but
    the source is the live Proxmox HA config, not a Plus hook. If the VM/CT is an
    HA resource with desired state ``started`` and ``confirm`` is False, raise
    409 ``ha_managed`` with an explanatory payload (the HA manager would fight the
    action / bring the guest back up). A retry with ``?confirm=true`` skips the
    guard. Warnen, nicht blockieren (Leitentscheidung #6) — P3 blockt nie hart.

    **Strictly best-effort:** any read error / standalone-without-HA (404/403) →
    silently proceed (never break the underlying action, "es darf nicht kaputt
    gehen"). Only fires for HA resources with state ``started``; non-HA / stopped /
    disabled guests are unaffected (AC-AWARE-3). Matches by trailing ``:<vmid>``
    (a VMID is cluster-unique) so it is robust to the vm:/ct: prefix convention.
    """
    if confirm:
        return
    try:
        resources = await client.get_ha_resources(auth)
    except Exception:
        return  # HA unreadable / standalone / missing privileges → proceed
    matched_sid: str | None = None
    matched_state: str | None = None
    matched_group = None
    for r in resources:
        if not isinstance(r, dict):
            continue
        sid = str(r.get("sid") or r.get("id") or "")
        if sid.startswith("service:"):
            sid = sid[len("service:"):]
        if sid.endswith(f":{vmid}"):
            matched_sid = sid
            matched_state = str(r.get("state") or "")
            matched_group = r.get("group")
            break
    if matched_sid is None or matched_state != "started":
        return
    await write_audit_log(
        event_type="vm_ha_managed_warned",
        username=username,
        auth_type=auth_type,
        detail=f"vmid={vmid} sid={matched_sid} action={action} state={matched_state}",
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "ha_managed",
            "action": action,
            "sid": matched_sid,
            "state": matched_state,
            "group": matched_group,
        },
    )


async def _check_rbac(
    current_user: CurrentUser,
    vmid: int,
    vm_type: str,
    action: str,
    pve_node: str | None = None,
) -> None:
    """Raises 403 if local user lacks the required action on this resource.

    - admin / operator: portal-wide access, always allowed.
    - viewer / restricted: RBAC assignments required; no assignments → blocked.

    Code-Review-Fix: ``pve_node`` (der vom Caller bereits via ``_resolve_vm_access``
    aufgelöste Proxmox-Node-Name) wird in die Portal-Node-ID übersetzt und an
    ``resolve_user_permissions`` durchgereicht. Damit greift ein node-scoped
    Assignment nur auf der richtigen Installation (kein Cross-Installation-Leak
    bei kollidierenden VMIDs). Ohne ``pve_node`` bleibt das Verhalten unverändert.
    """
    if current_user.auth_type == "proxmox" or current_user.role in ("admin", "operator"):
        return
    user = await get_user_by_username(current_user.username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )
    portal_node_id: int | None = None
    if pve_node:
        from backend.services.nodes_service import get_node_for_proxmox_name
        node_row = await get_node_for_proxmox_name(pve_node)
        portal_node_id = node_row.id if node_row else None
    res_type = "lxc" if vm_type == "lxc" else "vm"
    # Code-Review-Fix (Befund 1C): über ALLE Quellen unionieren – direkte
    # Assignments (PROJ-12) + Pool (PROJ-46) + Node-Scope (PROJ-47) + Owner
    # (PROJ-48). Vorher zählte nur PROJ-12 → Pool/Node/Owner-Grants waren
    # wirkungslos und ein viewer mit Pool-Zugriff bekam 403. Kein harter
    # Decke: das zugewiesene Preset darf einen viewer im Scope hochstufen.
    allowed = await resolve_user_permissions(user["id"], portal_node_id, vmid, res_type)
    if action not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Action '{action}' not permitted on {res_type} {vmid}",
        )


async def _build_auth_for_node(current_user: CurrentUser, node) -> ProxmoxAuth:
    """Build ProxmoxAuth bound to a specific portal node.

    Proxmox-login users: PVE ticket cookie (URL-agnostic, only valid against the
    Proxmox instance they logged in to — see the proxmox-login deprecation note).
    Local users: role-specific API token from this exact node row.
    """
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        return ProxmoxAuth(
            kind="cookie",
            value=session["ticket"],
            csrf=session.get("csrf", ""),
        )
    token = _extract_token(node, current_user.role)
    if current_user.role in ("viewer", "restricted"):
        # RBAC users may have a viewer token but it lacks write permissions.
        # Always prefer operator/admin so the portal's RBAC layer controls access.
        token = _extract_token(node, "operator") or _extract_token(node, "admin") or token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"{current_user.role.capitalize()} service account not configured"
                f" for node '{node.name}'"
            ),
        )
    return ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)


async def _resolve_vm_access(
    current_user: CurrentUser,
    vmid: int,
    proxmox_node: str | None = None,
) -> tuple[ProxmoxClient, ProxmoxAuth, str, str]:
    """Locate VMID and return (per-node client, auth, proxmox_node, vm_type).

    Resolution strategy:

    1. If ``proxmox_node`` (?node= query) is given, look up that node row and
       confirm the VM exists there. This is the unambiguous path used by the
       frontend whenever the VM listing already knows the node — required for
       Multi-Node setups where VMIDs can collide across standalone Proxmox
       installations.
    2. Otherwise, Plus + local users fan out over all portal nodes; the first
       VMID hit wins. Errors and missing tokens on individual nodes are
       silently skipped so a misconfigured node doesn't break the others.
    3. Core edition or proxmox-login users fall back to the default node and
       its /cluster/resources view (single-cluster assumption).
    """
    from backend.services.nodes_service import (
        get_default_node,
        get_node_for_proxmox_name,
        list_nodes,
    )

    # ── 1) Explicit node from query parameter ────────────────────────────────
    if proxmox_node:
        node_row = await get_node_for_proxmox_name(proxmox_node)
        if node_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Portal node for Proxmox node '{proxmox_node}' not configured",
            )
        auth = await _build_auth_for_node(current_user, node_row)
        client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
        resources = await client.get_cluster_resources_v2(auth, "vm")
        for r in resources:
            if int(r.get("vmid", -1)) == vmid:
                return (
                    client,
                    auth,
                    str(r.get("node") or proxmox_node),
                    str(r.get("type", "qemu")),
                )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"VM {vmid} not found on node '{proxmox_node}'",
        )

    # ── 2) Plus + local: fan-out over all portal nodes ───────────────────────
    from backend.core.plus_protocol import plus_behavior

    if plus_behavior.can_use_cluster_resources() and current_user.auth_type != "proxmox":
        all_nodes = await list_nodes()
        if not all_nodes:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Portal node configured – run the setup wizard",
            )
        for node_row in all_nodes:
            try:
                auth = await _build_auth_for_node(current_user, node_row)
            except HTTPException:
                continue
            client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
            try:
                resources = await client.get_cluster_resources_v2(auth, "vm")
            except Exception:
                continue
            for r in resources:
                if int(r.get("vmid", -1)) == vmid:
                    return (
                        client,
                        auth,
                        str(r.get("node") or node_row.name),
                        str(r.get("type", "qemu")),
                    )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"VM {vmid} not found")

    # ── 3) Core / proxmox-login: default node only ───────────────────────────
    node_row = await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Portal node configured – run the setup wizard",
        )
    auth = await _build_auth_for_node(current_user, node_row)
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    resources = await client.get_cluster_resources_v2(auth, "vm")
    for r in resources:
        if int(r.get("vmid", -1)) == vmid:
            return client, auth, str(r.get("node")), str(r.get("type", "qemu"))
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"VM {vmid} not found")


def _handle_proxmox_error(exc: httpx.HTTPStatusError) -> NoReturn:
    if exc.response.status_code == 403:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied by Proxmox")
    raise HTTPException(status_code=exc.response.status_code, detail="Proxmox API error")


def _disk_write_http_exc(exc: httpx.HTTPStatusError) -> NoReturn:
    """Map Proxmox errors for disk write ops (PROJ-81 AC-RBAC-3 / EC-14).

    Unlike the generic cluster mapper, a Proxmox 403 is surfaced as a real 403
    with a clear hint (the token lacks the disk privileges), and a 401 becomes
    a 502 so a deleted/rotated token never logs the portal user out.
    """
    code = exc.response.status_code
    if code == 403:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Proxmox token lacks the required privileges "
                "(VM.Config.Disk + Datastore.Allocate/AllocateSpace)"
            ),
        )
    if code == 401:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox authentication failed",
        )
    raise HTTPException(status_code=code, detail="Proxmox API error")


# ── VM Power Operations ───────────────────────────────────────────────────────

@router.post("/vms/{vmid}/start", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def vm_start(
    vmid: int,
    node: str | None = Query(default=None, description="Proxmox node hosting the VM (Multi-Node disambiguation)"),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "start", pve_node)
        task_id = await client.vm_power_action(auth, pve_node, vmid, "start", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/stop", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def vm_stop(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "stop", pve_node)
        await _dependency_impact(
            pve_node, vmid, confirm, "stop", current_user.username, current_user.auth_type
        )
        await _assert_ha_confirmed(
            client, auth, vmid, confirm, "stop", current_user.username, current_user.auth_type
        )
        task_id = await client.vm_power_action(auth, pve_node, vmid, "shutdown", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/reboot", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def vm_reboot(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "reboot", pve_node)
        await _dependency_impact(
            pve_node, vmid, confirm, "reboot", current_user.username, current_user.auth_type
        )
        task_id = await client.vm_power_action(auth, pve_node, vmid, "reboot", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Configuration (CPU / RAM / flags) ──────────────────────────────────────

@router.patch("/vms/{vmid}/config", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_vm_config(
    vmid: int,
    body: VmConfigUpdateRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Apply a CPU/RAM/flag change to a VM or LXC via a single config diff.

    QEMU CPU/RAM changes generally only take effect after a restart unless
    hot-plug is enabled; LXC changes usually apply live. Requires the
    ``configure`` action (admin/operator portal-wide, or RBAC assignment).
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure", pve_node)
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)

        updates: dict = {}
        delete_keys: list[str] = []

        if body.cores is not None:
            updates["cores"] = body.cores
        if body.memory is not None:
            updates["memory"] = body.memory
        if body.onboot is not None:
            updates["onboot"] = 1 if body.onboot else 0
        if body.protection is not None:
            updates["protection"] = 1 if body.protection else 0
        # QEMU-only
        if vm_type == "qemu" and body.sockets is not None:
            updates["sockets"] = body.sockets
        # LXC-only
        if vm_type == "lxc" and body.swap is not None:
            updates["swap"] = body.swap
        # description: empty string removes the field
        if body.description is not None:
            if body.description.strip():
                updates["description"] = body.description
            else:
                delete_keys.append("description")

        if not updates and not delete_keys:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No configuration changes provided",
            )

        await client.put_vm_config(auth, pve_node, vmid, updates, delete_keys, vm_type)

        changed = sorted([*updates.keys(), *(f"-{k}" for k in delete_keys)])
        await write_audit_log(
            event_type="vm_config_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"{vm_type} {vmid} on {pve_node}: {', '.join(changed)}",
        )
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Disk Management (PROJ-81, QEMU, Proxmox-only) ──────────────────────────

_DISK_BUSES = ("scsi", "virtio", "sata", "ide")
_BUS_MAX = {"scsi": 30, "virtio": 15, "sata": 5}   # highest valid index per bus
_DISK_SLOT_PATTERN = r"^(scsi|virtio|sata|ide)\d+$"


def _next_free_disk_slot(config: dict, bus: str) -> int:
    """Return the lowest unused index for *bus*; 422 when all slots are taken."""
    used = {int(k[len(bus):]) for k in config if k.startswith(bus) and k[len(bus):].isdigit()}
    for idx in range(_BUS_MAX[bus] + 1):
        if idx not in used:
            return idx
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"No free {bus} slot available",
    )


def _size_to_gib(raw: str) -> float:
    """Parse a Proxmox size string ('32G', '512M', '1T') to GiB."""
    s = (raw or "").strip()
    if not s:
        return 0.0
    unit = s[-1].upper()
    factors = {"K": 1024, "M": 1024 ** 2, "G": 1024 ** 3, "T": 1024 ** 4}
    try:
        if unit in factors:
            return float(s[:-1]) * factors[unit] / (1024 ** 3)
        return float(s) / (1024 ** 3)  # plain bytes
    except ValueError:
        return 0.0


def _first_boot_disk(config: dict) -> str | None:
    """Return the boot/root disk slot, or None if it can't be determined.

    Prefers the explicit ``bootdisk`` key, else the first disk-like entry in the
    ``boot order=`` list.
    """
    bootdisk = config.get("bootdisk")
    if isinstance(bootdisk, str) and bootdisk.strip():
        return bootdisk.strip()
    boot = config.get("boot")
    if isinstance(boot, str) and "order=" in boot:
        order = boot.split("order=", 1)[1].split(",")[0]
        for entry in order.split(";"):
            entry = entry.strip()
            if any(entry.startswith(b) and entry[len(b):].isdigit() for b in _DISK_BUSES):
                return entry
    return None


def _qemu_disks(config: dict) -> list:
    """Parse the QEMU disks out of a VM config (reuses cluster._parse_disks)."""
    from backend.routers.cluster import _parse_disks
    return _parse_disks(config, "qemu")


async def _resolve_node_read_auth(
    current_user: CurrentUser, node_name: str
) -> tuple[ProxmoxClient, ProxmoxAuth]:
    """Build a read client/auth for a node (admin→operator→viewer token chain).

    Listing ``/nodes/{node}/storage`` can require more than a viewer token, so
    the strongest available read token is preferred (analog vm-options / iso).
    """
    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(node_name) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
    if current_user.auth_type == "proxmox":
        auth = await _build_auth_for_node(current_user, node_row)
    else:
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
        auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    return client, auth


@router.get("/nodes/{node}/image-storages", response_model=list[ImageStorageInfo], dependencies=[_SCOPE_READ])
async def list_image_storages(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ImageStorageInfo]:
    """List storages on *node* that can hold VM disk images (datastore dropdown)."""
    try:
        client, auth = await _resolve_node_read_auth(current_user, node)
        raw = await client.get_node_image_storages(auth, node)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return [
        ImageStorageInfo(
            name=str(s.get("storage", "")),
            type=str(s.get("type", "")),
            avail=int(s.get("avail", 0) or 0),
            total=int(s.get("total", 0) or 0),
            used=int(s.get("used", 0) or 0),
            shared=bool(int(s.get("shared", 0) or 0)),   # PROJ-101
            content=str(s.get("content", "")),           # PROJ-101
        )
        for s in raw
        if s.get("storage")
    ]


@router.post("/vms/{vmid}/disks", response_model=DiskListResponse, dependencies=[_SCOPE_WRITE])
async def attach_disk(
    vmid: int,
    body: DiskAttachRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DiskListResponse:
    """Create + attach an additional disk to a QEMU VM (synchronous)."""
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure", pve_node)
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        if vm_type != "qemu":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Disk management is only supported for QEMU VMs",
            )

        config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        index = _next_free_disk_slot(config, body.bus)
        serial = f"p3-{uuid.uuid4().hex[:8]}"
        await client.attach_vm_disk(
            auth, pve_node, vmid, body.bus, index, body.storage, body.size_gb, serial
        )
        slot = f"{body.bus}{index}"
        await write_audit_log(
            event_type="vm_disk_attached",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"qemu {vmid} on {pve_node}: {slot}={body.storage}:{body.size_gb}G",
        )
        new_config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        return DiskListResponse(disks=_qemu_disks(new_config), disk=slot)
    except httpx.HTTPStatusError as exc:
        _disk_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/vms/{vmid}/disks/{disk}/resize", response_model=DiskListResponse, dependencies=[_SCOPE_WRITE])
async def resize_disk(
    vmid: int,
    body: DiskResizeRequest,
    disk: str = Path(..., pattern=_DISK_SLOT_PATTERN),
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DiskListResponse:
    """Grow an existing QEMU disk (synchronous; Proxmox cannot shrink)."""
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure", pve_node)
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        if vm_type != "qemu":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Disk management is only supported for QEMU VMs",
            )

        config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        raw = config.get(disk)
        if not raw or str(raw).startswith("none") or ",media=cdrom" in str(raw):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Disk {disk} not found")
        current_gib = next(
            (_size_to_gib(d.size) for d in _qemu_disks(config) if d.id == disk), 0.0
        )
        if body.size_gb <= current_gib:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"New size ({body.size_gb} GiB) must be larger than the current "
                    f"size ({current_gib:.0f} GiB) — Proxmox cannot shrink disks"
                ),
            )

        await client.resize_vm_disk(auth, pve_node, vmid, disk, body.size_gb)
        await write_audit_log(
            event_type="vm_disk_resized",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"qemu {vmid} on {pve_node}: {disk} → {body.size_gb}G",
        )
        new_config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        return DiskListResponse(disks=_qemu_disks(new_config), disk=disk)
    except httpx.HTTPStatusError as exc:
        _disk_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/disks/{disk}", response_model=DiskListResponse, dependencies=[_SCOPE_WRITE])
async def remove_disk(
    vmid: int,
    disk: str = Path(..., pattern=_DISK_SLOT_PATTERN),
    confirm: str = Query(..., description="VM name typed by the user to confirm the destructive action"),
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DiskListResponse:
    """Detach + physically purge a QEMU disk (synchronous, irreversible).

    Guards: name-confirmation token, root/boot-disk protection, stack-block.
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure", pve_node)
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        if vm_type != "qemu":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Disk management is only supported for QEMU VMs",
            )

        config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        expected = str(config.get("name") or vmid)
        if confirm != expected:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Confirmation does not match the VM name",
            )
        raw = config.get(disk)
        if not raw or str(raw).startswith("none") or ",media=cdrom" in str(raw):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Disk {disk} not found")

        # Root-/boot-disk protection (EC-3): explicit boot disk, else index-0 fallback.
        boot_disk = _first_boot_disk(config)
        is_root = (disk == boot_disk) if boot_disk is not None else any(
            disk == f"{b}0" for b in _DISK_BUSES
        )
        if is_root:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The root/boot disk cannot be removed",
            )

        await client.delete_vm_disk(auth, pve_node, vmid, disk)
        await write_audit_log(
            event_type="vm_disk_removed",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"qemu {vmid} on {pve_node}: {disk}",
        )
        new_config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        return DiskListResponse(disks=_qemu_disks(new_config), disk=disk)
    except httpx.HTTPStatusError as exc:
        _disk_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Snapshot Management ───────────────────────────────────────────────────────

@router.get("/vms/{vmid}/snapshots", response_model=list[SnapshotInfo], dependencies=[_SCOPE_READ])
async def list_snapshots(
    vmid: int,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SnapshotInfo]:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot", pve_node)
        raw = await client.get_snapshots(auth, pve_node, vmid, vm_type)
        return [SnapshotInfo.model_validate(s) for s in raw if s.get("name") != "current"]
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/snapshots", response_model=VmTaskResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
async def create_snapshot(
    vmid: int,
    body: SnapshotCreateRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot", pve_node)
        task_id = await client.create_snapshot(auth, pve_node, vmid, body.name, body.description, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 500:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Snapshot with this name already exists")
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/snapshots/{snap_name}/rollback", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def rollback_snapshot(
    vmid: int,
    snap_name: str,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot", pve_node)
        await _dependency_impact(
            pve_node, vmid, confirm, "rollback", current_user.username, current_user.auth_type
        )
        task_id = await client.rollback_snapshot(auth, pve_node, vmid, snap_name, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/snapshots/{snap_name}", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def delete_snapshot(
    vmid: int,
    snap_name: str,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot", pve_node)
        task_id = await client.delete_snapshot(auth, pve_node, vmid, snap_name, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Deletion ───────────────────────────────────────────────────────────────

@router.delete("/vms/{vmid}", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def delete_vm(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(require_admin),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "delete", pve_node)
        # PROJ-76: single-VM delete blocked for stack-managed VMs (use stack destroy).
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        # PROJ-96: warn (resumable) when other VMs depend on this one.
        await _dependency_impact(
            pve_node, vmid, confirm, "delete", current_user.username, current_user.auth_type
        )
        # PROJ-42 Phase 2: warn (resumable) when this VM holds an IPAM allocation.
        await _ipam_release_impact(
            pve_node, vmid, confirm, current_user.username, current_user.auth_type
        )
        task_id = await client.delete_vm(auth, pve_node, vmid, vm_type)
        # PROJ-64: Pending Approvals für diese VM/LXC canceln (Plus-Protocol-Hook)
        try:
            from backend.core.plus_protocol import plus_behavior
            await plus_behavior.on_vm_lxc_deleted_approval_workflow(pve_node, vmid, current_user.username)
        except Exception:
            pass
        # PROJ-74: Config-Snapshots orphan-markieren (Plus-Protocol-Hook)
        try:
            from backend.core.plus_protocol import plus_behavior as _pb
            from backend.services.nodes_service import get_node_for_proxmox_name as _gnfpn
            _node_row = await _gnfpn(pve_node)
            if _node_row is not None:
                await _pb.on_vm_lxc_deleted_config_snapshots(
                    _node_row.id, pve_node, vmid, vm_type,
                    None, current_user.username,
                )
                # PROJ-77: native Auto-Snapshots als rotated/vm_deleted markieren
                try:
                    await _pb.on_vm_lxc_deleted_auto_snapshots(
                        _node_row.id, vmid, vm_type, current_user.username,
                    )
                except Exception:
                    pass
                # PROJ-96: VM-Abhängigkeits-Kanten als „verwaist" markieren (nie löschen)
                try:
                    await _pb.on_vm_lxc_deleted_dependencies(
                        _node_row.id, vmid, current_user.username,
                    )
                except Exception:
                    pass
                # PROJ-42 Phase 2: IPAM-Allocation der gelöschten VM freigeben
                try:
                    await _pb.on_vm_lxc_deleted_ipam(
                        _node_row.id, vmid, current_user.username,
                    )
                except Exception:
                    pass
        except Exception:
            pass
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM/LXC Lifecycle: Clone / Migrate / Convert-to-Template (PROJ-102) ────────

async def _create_lifecycle_job(
    action: str,
    current_user: CurrentUser,
    vmid: int,
    label_ref: str,
    dispatch_kwargs: dict,
) -> JobResponse:
    """Persist a lifecycle job (own type string) and dispatch the async worker.

    Mirrors the stacks job-insert pattern (``type='vm_<action>'``, synthetic
    ``playbook`` label). The worker runs in-process via ``asyncio.create_task``
    and drives the Proxmox op + live-log + status update.
    """
    from backend.services.vm_lifecycle_service import run_vm_lifecycle_job

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    job_type = f"vm_{action}"
    playbook_label = f"{action}:{label_ref}"
    params = {k: v for k, v in dispatch_kwargs.items() if k in (
        "vmid", "vm_type", "newid", "name", "target_storage", "full",
        "set_owner", "target_node", "pve_node",
    )}
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

    asyncio.create_task(run_vm_lifecycle_job(job_id, action, **dispatch_kwargs))
    return JobResponse(
        id=job_id, type=job_type, playbook=playbook_label, status="pending",
        created_at=now, username=current_user.username, params=params,
    )


@router.get("/vms/{vmid}/migration-targets", response_model=MigrationTargetsResponse, dependencies=[_SCOPE_READ])
async def get_migration_targets(
    vmid: int,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> MigrationTargetsResponse:
    """Other cluster_nodes of this installation (without the current node).

    Empty list → single-node installation → Migrate disabled (AC-MIG-1/3).
    """
    from backend.services.nodes_service import get_node_for_proxmox_name

    _, _, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
    await _check_rbac(current_user, vmid, vm_type, "migrate", pve_node)
    node_row = await get_node_for_proxmox_name(pve_node)
    targets: list[str] = []
    if node_row is not None:
        targets = [n for n in (node_row.cluster_nodes or []) if n and n != pve_node]
    return MigrationTargetsResponse(current_node=pve_node, targets=sorted(targets))


@router.get("/nodes/{node}/rootdir-storages", response_model=list[RootdirStorageInfo], dependencies=[_SCOPE_READ])
async def list_rootdir_storages(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[RootdirStorageInfo]:
    """List storages on *node* that can hold LXC rootfs volumes (clone target)."""
    try:
        client, auth = await _resolve_node_read_auth(current_user, node)
        raw = await client.get_node_rootdir_storages(auth, node)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return [
        RootdirStorageInfo(
            name=str(s.get("storage", "")),
            type=str(s.get("type", "")),
            avail=int(s.get("avail", 0) or 0),
            total=int(s.get("total", 0) or 0),
            used=int(s.get("used", 0) or 0),
        )
        for s in raw
        if s.get("storage")
    ]


@router.post("/vms/{vmid}/clone", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
async def clone_vm(
    vmid: int,
    body: CloneRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Clone a VM/LXC onto the same node (Core). Runs as a job with live-log.

    Clone is allowed on a running guest (AC-CLONE-4) and is NOT stack-blocked —
    it only reads the source and creates an independent non-stack copy.
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "clone", pve_node)

        # Linked-Clone nur wenn Quelle ein Template ist (Proxmox-Constraint, AC-CLONE-2).
        if not body.full:
            config = await client.get_vm_config(auth, pve_node, vmid, vm_type)
            if str(config.get("template", 0)) not in ("1", "True"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Linked-Clone ist nur von einem Template möglich",
                )

        # Ziel-VMID: vorgegeben (Konflikt-Check) oder auto next-free.
        if body.newid is not None:
            try:
                free = await client.get_next_vmid(auth, body.newid, body.newid)
            except ValueError:
                free = None
            if free != body.newid:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"VMID {body.newid} ist bereits belegt",
                )
            newid = body.newid
        else:
            newid = await client.get_next_vmid(auth, 100, 999999)

        return await _create_lifecycle_job(
            "clone", current_user, vmid, str(newid),
            {
                "client": client, "auth": auth, "pve_node": pve_node,
                "vmid": vmid, "vm_type": vm_type,
                "actor_username": current_user.username,
                "actor_user_id": current_user.user_id,
                "newid": newid, "name": body.name,
                "target_storage": body.target_storage, "full": body.full,
                "set_owner": body.set_owner,
            },
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/migrate", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
async def migrate_vm(
    vmid: int,
    body: MigrateRequest,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Offline-migrate a VM/LXC to another node in the same cluster (Core).

    Blocked for stack-managed guests (409, AC-STACK-1) and for running guests
    (409, AC-STATE-1). HA-managed guests (Soll started) yield a resumable 409
    ``ha_managed`` without ``confirm`` (PROJ-103 AC-AWARE-1). Runs as a job.
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "migrate", pve_node)
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        await _assert_ha_confirmed(
            client, auth, vmid, confirm, "migrate", current_user.username, current_user.auth_type
        )

        # Nur bei gestopptem Gast (AC-STATE-1).
        st = await client.get_vm_status_current(auth, pve_node, vmid, vm_type)
        if st.get("status") != "stopped":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Migration nur bei gestopptem Gast möglich – zuerst stoppen",
            )

        # Ziel muss ein anderer cluster_node derselben Installation sein (AC-MIG-1).
        from backend.services.nodes_service import get_node_for_proxmox_name
        node_row = await get_node_for_proxmox_name(pve_node)
        valid_targets = set((node_row.cluster_nodes or []) if node_row else [])
        valid_targets.discard(pve_node)
        if body.target_node not in valid_targets:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{body.target_node}' ist keine gültige Ziel-Node dieses Clusters",
            )

        return await _create_lifecycle_job(
            "migrate", current_user, vmid, body.target_node,
            {
                "client": client, "auth": auth, "pve_node": pve_node,
                "vmid": vmid, "vm_type": vm_type,
                "actor_username": current_user.username,
                "actor_user_id": current_user.user_id,
                "target_node": body.target_node,
                "target_storage": body.target_storage,
            },
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/convert-template", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
async def convert_to_template(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Convert a stopped VM/LXC into a template (Core). Runs as a job with live-log.

    Blocked for stack-managed guests (409) and for running guests (409).
    HA-managed guests (Soll started) yield a resumable 409 ``ha_managed`` without
    ``confirm`` (PROJ-103 AC-AWARE-1). An existing owner entry is removed by the
    worker (a template has no owner).
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "template", pve_node)
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        await _assert_ha_confirmed(
            client, auth, vmid, confirm, "template", current_user.username, current_user.auth_type
        )

        st = await client.get_vm_status_current(auth, pve_node, vmid, vm_type)
        if st.get("status") != "stopped":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Konvertierung nur bei gestopptem Gast möglich – zuerst stoppen",
            )
        if str(st.get("template", 0)) in ("1", "True"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Gast ist bereits ein Template",
            )

        return await _create_lifecycle_job(
            "template", current_user, vmid, str(vmid),
            {
                "client": client, "auth": auth, "pve_node": pve_node,
                "vmid": vmid, "vm_type": vm_type,
                "actor_username": current_user.username,
                "actor_user_id": current_user.user_id,
            },
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM IP + SSH Check ────────────────────────────────────────────────────────

@router.get("/vms/{node}/{vmid}/ip", dependencies=[_SCOPE_READ])
async def get_vm_ip(
    node: str,
    vmid: int,
    type: str = Query(default="qemu", pattern="^(qemu|lxc)$"),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    # node is in the path here — resolve auth+client for that specific node.
    from backend.services.nodes_service import get_node_for_proxmox_name, get_default_node

    node_row = await get_node_for_proxmox_name(node) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Portal node configured",
        )
    auth = await _build_auth_for_node(current_user, node_row)
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    ip = await client.get_vm_ip(auth, node, vmid, type)
    return {"ip": ip}


@router.get("/vms/{node}/{vmid}/ssh-check", dependencies=[_SCOPE_READ])
async def check_vm_ssh(
    node: str,
    vmid: int,
    ip: str = Query(...),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ip, 22), timeout=3.0)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return {"reachable": True}
    except Exception:
        return {"reachable": False}


# ── Service Account Status ────────────────────────────────────────────────────

@router.get("/service-accounts/status", response_model=ServiceAccountStatusResponse, dependencies=[_SCOPE_READ])
async def get_service_account_status(
    _: CurrentUser = Depends(require_admin),
) -> ServiceAccountStatusResponse:
    return ServiceAccountStatusResponse(**await get_service_account_status())
