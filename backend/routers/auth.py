# p3portal.org
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.core.config import settings
from backend.core.deps import CurrentUser, get_current_user
from backend.core.security import create_access_token
from backend.models.auth import (
    LocalLoginRequest,
    LoginRequest,
    PermissionsResponse,
    TokenResponse,
)
from backend.services.audit_service import write_audit_log
from backend.services.local_auth import get_user_by_username, update_last_login, verify_password
import json as _json
from backend.services.profile_service import update_last_login as update_proxmox_last_login
from backend.services.proxmox import proxmox_client
from backend.services.session_credential_store import clear_credentials, store_credentials
from backend.services.session_service import create_session, revoke_session_by_jti


def _expires_at() -> str:
    return (
        datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    ).isoformat()

router = APIRouter(prefix="/api", tags=["auth"])

# ── Rate limiting (in-memory, per IP) ────────────────────────────────────────
_RATE_LIMIT = 5
_RATE_WINDOW_S = 60
_login_attempts: dict[str, list[datetime]] = defaultdict(list)


def _check_rate_limit(ip: str) -> None:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=_RATE_WINDOW_S)
    _login_attempts[ip] = [t for t in _login_attempts[ip] if t > cutoff]
    if len(_login_attempts[ip]) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts – try again later",
        )
    _login_attempts[ip].append(now)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/auth/login", response_model=TokenResponse, status_code=200)
async def login(body: LoginRequest, request: Request) -> TokenResponse:
    client_ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent")

    try:
        _check_rate_limit(client_ip)
    except HTTPException:
        await write_audit_log("login_failed", body.username, "proxmox", client_ip, ua, "Rate limit exceeded")
        raise

    try:
        data = await proxmox_client.authenticate(body.username, body.password, body.realm)
    except httpx.HTTPStatusError:
        await write_audit_log("login_failed", body.username, "proxmox", client_ip, ua, "Authentication failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Proxmox API",
        )

    proxmox_username: str = data["username"]
    proxmox_client.store_session(proxmox_username, data)

    jti = str(uuid.uuid4())
    token = create_access_token(proxmox_username, auth_type="proxmox", role="operator", jti=jti)
    expires = _expires_at()
    try:
        await create_session(proxmox_username, jti, expires, client_ip, ua)
        await update_proxmox_last_login(proxmox_username, "proxmox", client_ip)
    except Exception:
        pass  # non-fatal – login still succeeds
    store_credentials(jti, body.username, body.password, body.realm)
    await write_audit_log("login_success", proxmox_username, "proxmox", client_ip, ua)
    return TokenResponse(access_token=token)


@router.post("/auth/login/local", response_model=TokenResponse, status_code=200)
async def login_local(body: LocalLoginRequest, request: Request) -> TokenResponse:
    client_ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent")

    try:
        _check_rate_limit(client_ip)
    except HTTPException:
        await write_audit_log("login_failed", body.username, "local", client_ip, ua, "Rate limit exceeded")
        raise

    user = await get_user_by_username(body.username)
    # Generic error – no hint whether username or password is wrong
    if user is None or not verify_password(body.password, user["password_hash"]):
        await write_audit_log("login_failed", body.username, "local", client_ip, ua, "Authentication failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )
    if not user["active"]:
        await write_audit_log("login_failed", body.username, "local", client_ip, ua, "Account deactivated")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )

    must_change_pw = bool(user.get("must_change_password", 0))
    raw_perms = user.get("portal_permissions", "[]")
    try:
        portal_perms: list[str] = _json.loads(raw_perms or "[]")
    except Exception:
        portal_perms = []
    jti = str(uuid.uuid4())
    token = create_access_token(
        user["username"],
        auth_type="local",
        role=user["role"],
        jti=jti,
        must_change_pw=must_change_pw,
        portal_permissions=portal_perms,
    )
    expires = _expires_at()
    try:
        await create_session(user["username"], jti, expires, client_ip, ua)
        await update_last_login(user["username"], client_ip)
    except Exception:
        pass  # non-fatal
    await write_audit_log("login_success", user["username"], "local", client_ip, ua)
    return TokenResponse(access_token=token)


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, current_user: CurrentUser = Depends(get_current_user)) -> None:
    client_ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent")
    if current_user.auth_type == "proxmox":
        proxmox_client.clear_session(current_user.username)
        if current_user.jti:
            clear_credentials(current_user.jti)
    if current_user.jti:
        try:
            await revoke_session_by_jti(current_user.jti)
        except Exception:
            pass
    await write_audit_log("logout", current_user.username, current_user.auth_type, client_ip, ua)


@router.get("/me/permissions", response_model=PermissionsResponse)
async def me_permissions(current_user: CurrentUser = Depends(get_current_user)) -> PermissionsResponse:
    if current_user.auth_type == "local":
        # Local users have no Proxmox capabilities – return app role as single cap entry
        return PermissionsResponse(
            username=current_user.username,
            capabilities={"app_role": [current_user.role]},
            groups=[],
        )

    session = proxmox_client.get_session(current_user.username)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired – please login again",
        )

    groups: list[str] = []
    try:
        user_info = await proxmox_client.get_user_info(session["ticket"], current_user.username)
        groups = user_info.get("groups", []) or []
    except (httpx.HTTPStatusError, httpx.RequestError):
        pass

    return PermissionsResponse(
        username=current_user.username,
        capabilities=session.get("cap", {}),
        groups=groups,
    )
