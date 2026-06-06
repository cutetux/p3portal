# p3portal.org
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, field_validator

from backend.core.deps import CurrentUser, get_current_user, require_admin, require_admin_or, require_logs_access
from backend.core.plus_protocol import plus_behavior
from backend.models.auth import PortalPermissionsRequest, UserCreateRequest, UserResponse, UserUpdateRequest
from backend.models.profile import ResetPasswordRequest
from backend.services.audit_service import count_audit_logs, get_audit_logs, write_audit_log
from backend.services.proxmox_audit_service import is_audit_enabled, read_audit_lines
from backend.services.local_auth import (
    count_active_admins,
    count_all_users,
    create_user,
    delete_user,
    get_user_by_id,
    get_user_by_username,
    list_users,
    reset_password,
    update_portal_permissions,
    update_user,
)
from backend.services.settings_service import delete_setting, get_setting, set_setting
from backend.services.config_service import get_config, set_config


class SshKeyRequest(BaseModel):
    key: str

    @field_validator("key")
    @classmethod
    def key_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("SSH key must not be empty")
        return v


class VmidRangeRequest(BaseModel):
    min: int
    max: int

    @field_validator("min", "max")
    @classmethod
    def valid_id(cls, v: int) -> int:
        if v < 100 or v > 999999999:
            raise ValueError("VM-ID muss zwischen 100 und 999999999 liegen")
        return v


class PackerHttpIpRequest(BaseModel):
    packer_http_ip: str = ""

    @field_validator("packer_http_ip")
    @classmethod
    def valid_ip(cls, v: str) -> str:
        return v.strip()

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/admin/users", response_model=list[UserResponse])
async def get_users(_: CurrentUser = Depends(require_admin_or("manage_users"))) -> list[UserResponse]:
    return await list_users()


@router.post("/admin/users", response_model=UserResponse, status_code=201)
async def create_local_user(
    body: UserCreateRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> UserResponse:
    max_users = plus_behavior.get_max_users()
    if max_users is not None:
        current_count = await count_all_users()
        if current_count >= max_users:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Core Edition: Maximale Benutzeranzahl ({max_users}) erreicht. Upgrade auf P3 Plus für unbegrenzte Benutzer.",
            )
    existing = await get_user_by_username(body.username)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )
    user = await create_user(body.username, body.password, body.role)
    await write_audit_log(
        "user_created", current_user.username, current_user.auth_type,
        detail=f"Nutzer '{body.username}' (Rolle: {body.role}) erstellt"
    )
    return user


@router.patch("/admin/users/{user_id}", response_model=UserResponse)
async def update_local_user(
    user_id: int,
    body: UserUpdateRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> UserResponse:
    target = await get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Self-lockout protection: prevent reducing active admin count to zero
    would_lose_admin = (
        (body.role is not None and body.role != "admin" and target.role == "admin")
        or (body.active is False and target.role == "admin" and target.active)
    )
    if would_lose_admin:
        active_admins = await count_active_admins()
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot remove the last active admin",
            )

    updated = await update_user(user_id, body.password, body.role, body.active)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # PROJ-67 Phase 1 – F-003: Sessions invalidieren wenn Nutzer deaktiviert wird
    if body.active is False and target.active:
        from backend.services.session_service import revoke_all_for_user
        await revoke_all_for_user(target.username, reason="user_disabled")

    changes = []
    if body.role is not None: changes.append(f"Rolle→{body.role}")
    if body.active is not None: changes.append("aktiviert" if body.active else "deaktiviert")
    if body.password is not None: changes.append("Passwort geändert")
    await write_audit_log(
        "user_updated", current_user.username, current_user.auth_type,
        detail=f"Nutzer '{target.username}': {', '.join(changes)}"
    )
    return updated


@router.delete("/admin/users/{user_id}", status_code=204)
async def delete_local_user(
    user_id: int,
    ownership_action: str | None = Query(None, description="transfer|orphan (Pflicht wenn User Owner-Einträge hat)"),
    ownership_transfer_to: int | None = Query(None, description="Ziel-User-ID bei action=transfer"),
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> Response:
    target = await get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.role == "admin":
        active_admins = await count_active_admins()
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete the last active admin",
            )

    if target.username == current_user.username:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete your own account",
        )

    # PROJ-45: Audit-Log for group memberships/ownership before cascade deletion
    try:
        from backend.features.groups.service import cleanup_user_from_groups
        await cleanup_user_from_groups(user_id, target.username, current_user.username)
    except Exception:
        pass

    # PROJ-54: Sidebar-Pins-Audit-Log before cascade deletion (DB-Cascade handles actual DELETE)
    try:
        from backend.features.sidebar_pins.service import cleanup_pins_for_user
        await cleanup_pins_for_user(user_id, target.username, current_user.username)
    except Exception:
        pass

    # PROJ-47: Node-Assignments-Cleanup vor User-Delete
    try:
        from backend.features.node_assignments.service import cleanup_assignments_for_user
        await cleanup_assignments_for_user(user_id, current_user.username)
    except Exception:
        pass

    # PROJ-48: Owner-Cleanup vor User-Delete (ownership_action Pflicht wenn Owner-Einträge vorhanden)
    try:
        from backend.features.owners.cleanup import count_active_ownerships_for_user, on_user_delete as owners_on_user_delete
        owner_count = await count_active_ownerships_for_user(user_id)
        if owner_count > 0:
            if not ownership_action or ownership_action not in ("transfer", "orphan"):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"user_has_ownerships:{owner_count}",
                )
            await owners_on_user_delete(
                user_id=user_id,
                actor_username=current_user.username,
                action=ownership_action,
                transfer_to_user_id=ownership_transfer_to,
            )
    except HTTPException:
        raise
    except Exception:
        pass

    # PROJ-63: Playbook-Whitelist-Einträge für diesen User entfernen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_user_deleted_playbook_permissions(user_id, current_user.username)
    except Exception:
        pass

    # PROJ-62: Pool-Assignments für diesen User entfernen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_user_deleted_pools(user_id, current_user.username)
    except Exception:
        pass

    # PROJ-64: Pending Approvals für diesen User canceln (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_user_deleted_approval_workflow(user_id, current_user.username)
    except Exception:
        pass

    # PROJ-70: Scheduled-Jobs des Users löschen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_user_deleted_scheduled_jobs(user_id, current_user.username)
    except Exception:
        pass

    # PROJ-77: Auto-Snapshot-Jobs pausieren (paused_ownerless)
    try:
        await plus_behavior.on_user_deleted_auto_snapshots(user_id, current_user.username)
    except Exception:
        pass

    # PROJ-76: Stacks des Users auf Orphan setzen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_user_deleted_stacks(user_id)
    except Exception:
        pass

    await delete_user(user_id)
    await write_audit_log(
        "user_deleted", current_user.username, current_user.auth_type,
        detail=f"Nutzer '{target.username}' gelöscht"
    )
    return Response(status_code=204)


@router.put("/admin/users/{user_id}/portal-permissions", response_model=UserResponse)
async def set_user_portal_permissions(
    user_id: int,
    body: PortalPermissionsRequest,
    _: CurrentUser = Depends(require_admin),
) -> UserResponse:
    target = await get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    updated = await update_portal_permissions(user_id, body.portal_permissions)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return updated


@router.post("/admin/users/{user_id}/reset-password", response_model=UserResponse)
async def reset_user_password(
    user_id: int,
    body: ResetPasswordRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> UserResponse:
    target = await get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nutzer nicht gefunden")
    updated = await reset_password(user_id, body.new_password)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nutzer nicht gefunden")
    # PROJ-67 Phase 1 – F-003: Alle Sessions des Nutzers invalidieren
    from backend.services.session_service import revoke_all_for_user
    await revoke_all_for_user(target.username, reason="password_reset")
    await write_audit_log(
        "password_reset", current_user.username, current_user.auth_type,
        detail=f"Passwort für '{target.username}' zurückgesetzt"
    )
    return updated


# ── SSH-Key settings ──────────────────────────────────────────────────────────

@router.put("/admin/settings/ssh-key", status_code=204)
async def set_ssh_key(
    body: SshKeyRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    await set_setting("ssh_key", body.key, current_user.username)
    return Response(status_code=204)


@router.delete("/admin/settings/ssh-key", status_code=204)
async def delete_ssh_key(_: CurrentUser = Depends(require_admin_or("manage_settings"))) -> Response:
    await delete_setting("ssh_key")
    return Response(status_code=204)


# ── VM-ID-Bereich für Packer ──────────────────────────────────────────────────

@router.get("/admin/settings/packer-vmid-range")
async def get_packer_vmid_range(_: CurrentUser = Depends(require_admin_or("manage_settings"))) -> dict:
    min_val = await get_setting("packer_vmid_min")
    max_val = await get_setting("packer_vmid_max")
    return {
        "min": int(min_val) if min_val else 100,
        "max": int(max_val) if max_val else 999999,
    }


@router.put("/admin/settings/packer-vmid-range", status_code=204)
async def set_packer_vmid_range(
    body: VmidRangeRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    if body.min >= body.max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min muss kleiner als max sein",
        )
    await set_setting("packer_vmid_min", str(body.min), current_user.username)
    await set_setting("packer_vmid_max", str(body.max), current_user.username)
    return Response(status_code=204)


# ── VM-ID-Bereich für Playbooks ───────────────────────────────────────────────

@router.get("/admin/settings/playbook-vmid-range")
async def get_playbook_vmid_range(_: CurrentUser = Depends(require_admin_or("manage_settings"))) -> dict:
    min_val = await get_setting("playbook_vmid_min")
    max_val = await get_setting("playbook_vmid_max")
    return {
        "min": int(min_val) if min_val else 100,
        "max": int(max_val) if max_val else 999999,
    }


@router.put("/admin/settings/playbook-vmid-range", status_code=204)
async def set_playbook_vmid_range(
    body: VmidRangeRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    if body.min >= body.max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min muss kleiner als max sein",
        )
    await set_setting("playbook_vmid_min", str(body.min), current_user.username)
    await set_setting("playbook_vmid_max", str(body.max), current_user.username)
    return Response(status_code=204)


# ── Standard-Storage-Pool pro Node ───────────────────────────────────────────

class NodeDefaultStoragesRequest(BaseModel):
    defaults: dict[str, str]


@router.get("/admin/settings/node-default-storages")
async def get_node_default_storages(_: CurrentUser = Depends(require_admin_or("manage_settings"))) -> dict:
    raw = await get_setting("node_default_storages")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


@router.put("/admin/settings/node-default-storages", status_code=204)
async def set_node_default_storages(
    body: NodeDefaultStoragesRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    await set_setting("node_default_storages", json.dumps(body.defaults), current_user.username)
    return Response(status_code=204)


# ── Standard-Template pro Node ────────────────────────────────────────────────

class NodeDefaultTemplatesRequest(BaseModel):
    defaults: dict[str, int]


@router.get("/admin/settings/node-default-templates")
async def get_node_default_templates(_: CurrentUser = Depends(require_admin_or("manage_settings"))) -> dict:
    raw = await get_setting("node_default_templates")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


@router.put("/admin/settings/node-default-templates", status_code=204)
async def set_node_default_templates(
    body: NodeDefaultTemplatesRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    await set_setting("node_default_templates", json.dumps(body.defaults), current_user.username)
    return Response(status_code=204)


# ── PROJ-24: User API-Key Settings ───────────────────────────────────────────

class ApiKeySettingsRequest(BaseModel):
    api_keys_enabled: bool
    api_keys_allowed_scopes: list[str] | None = None
    api_keys_max_count: int | None = None

    @field_validator("api_keys_allowed_scopes")
    @classmethod
    def validate_scopes(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        from backend.services.user_api_key_service import VALID_SCOPES
        invalid = set(v) - VALID_SCOPES
        if invalid:
            raise ValueError(f"Unknown scopes: {sorted(invalid)}")
        return v

    @field_validator("api_keys_max_count")
    @classmethod
    def validate_max_count(cls, v: int | None) -> int | None:
        if v is not None and (v < 1 or v > 50):
            raise ValueError("api_keys_max_count must be between 1 and 50")
        return v


@router.get("/admin/users/{user_id}/api-key-settings")
async def get_user_api_key_settings(
    user_id: int,
    _: CurrentUser = Depends(require_admin_or("manage_users")),
) -> dict:
    from backend.services.user_api_key_service import (
        get_user_api_key_settings as _get_settings,
    )
    settings_data = await _get_settings(user_id)
    if settings_data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return settings_data


@router.put("/admin/users/{user_id}/api-key-settings", status_code=204)
async def update_user_api_key_settings(
    user_id: int,
    body: ApiKeySettingsRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> Response:
    from backend.services.user_api_key_service import (
        get_user_api_key_settings as _get_settings,
        update_user_api_key_settings as _update_settings,
    )

    # PROJ-44: Diff-Logging für allowed_scopes-Änderungen (AC-22)
    if body.api_keys_allowed_scopes is not None:
        existing = await _get_settings(user_id)
        if existing is not None:
            old_scopes = set(existing.get("allowed_scopes") or [])
            new_scopes = set(body.api_keys_allowed_scopes)
            added = sorted(new_scopes - old_scopes)
            removed = sorted(old_scopes - new_scopes)
            if added or removed:
                import asyncio
                from backend.features.api_surface.audit import record_scope_change
                asyncio.ensure_future(
                    record_scope_change(
                        target_user_id=user_id,
                        by_username=current_user.username,
                        added=added,
                        removed=removed,
                    )
                )

    found = await _update_settings(
        user_id=user_id,
        enabled=body.api_keys_enabled,
        allowed_scopes=body.api_keys_allowed_scopes,
        max_count=body.api_keys_max_count,
    )
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return Response(status_code=204)


# ── Audit Logs ────────────────────────────────────────────────────────────────

# ── Proxmox API Audit-Log ─────────────────────────────────────────────────────

@router.get("/admin/proxmox-audit")
async def list_proxmox_audit_log(
    _: CurrentUser = Depends(require_admin),
) -> list[dict]:
    """Return last 500 Proxmox API calls from the audit log (newest first).

    Returns 404 when PROXMOX_AUDIT_ENABLED is not set.
    Returns 403 for non-admins (enforced by require_admin above).
    """
    if not is_audit_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proxmox audit log not enabled")
    return read_audit_lines(n=500)


@router.get("/admin/settings/packer-http-ip")
async def get_packer_http_ip(
    _: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> dict:
    val = await get_config("packer_http_ip")
    return {"packer_http_ip": val or ""}


@router.put("/admin/settings/packer-http-ip", status_code=204)
async def set_packer_http_ip(
    body: PackerHttpIpRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    await set_config("packer_http_ip", body.packer_http_ip, is_secret=False, updated_by=current_user.username)
    return Response(status_code=204)


@router.get("/admin/proxmox-login")
async def get_proxmox_login_setting(
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> dict:
    val = await get_config("proxmox_login_enabled")
    return {"enabled": val == "true"}


@router.put("/admin/proxmox-login", status_code=204)
async def set_proxmox_login_setting(
    body: dict,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> Response:
    enabled = bool(body.get("enabled", False))
    await set_config("proxmox_login_enabled", "true" if enabled else "false", updated_by=current_user.username)
    await write_audit_log(
        "admin_action", current_user.username, current_user.auth_type,
        detail=f"Proxmox-Login {'aktiviert' if enabled else 'deaktiviert'}",
    )
    return Response(status_code=204)


@router.get("/admin/logs")
async def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=10000),  # le erhöht für „Alle anzeigen"
    offset: int = Query(default=0, ge=0),
    event_type: str | None = Query(default=None),
    username: str | None = Query(default=None),
    _: CurrentUser = Depends(require_logs_access),
) -> dict:
    logs = await get_audit_logs(limit=limit, offset=offset, event_type=event_type, username=username)
    total = await count_audit_logs(event_type=event_type, username=username)
    return {"items": logs, "total": total, "limit": limit, "offset": offset}
