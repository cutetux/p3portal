# p3portal.org
"""PROJ-21: Setup-Wizard API.

Security model:
  - When setup_complete=false: all endpoints are publicly accessible (no auth needed).
  - When setup_complete=true: all write endpoints require a valid admin JWT.
  - GET /api/setup/status is public during setup; admin-only after.

PROJ-25: Adds POST /api/setup/database and POST /api/setup/database/test.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

from backend.services.config_service import (
    get_config,
    is_setup_complete,
    set_config,
)
from backend.services.nodes_service import (
    count_nodes,
    create_node,
    get_default_node,
    set_default_node,
    test_connection,
    update_node,
)
from backend.core.config import settings as _settings

router = APIRouter(prefix="/api/setup", tags=["setup"])
_optional_bearer = HTTPBearer(auto_error=False)


# ── Security dependency ───────────────────────────────────────────────────────

async def _require_setup_access(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
) -> str | None:
    """Open during initial setup; requires admin JWT after setup is complete."""
    if not await is_setup_complete():
        return None
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Setup already complete – admin authentication required",
        )
    try:
        from backend.core.security import decode_access_token
        payload = decode_access_token(credentials.credentials)
        if payload.get("role") != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
        return payload.get("sub")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SetupStatusResponse(BaseModel):
    setup_required: bool
    has_admin: bool
    has_node: bool


class SetupAdminRequest(BaseModel):
    username: str
    password: str
    confirm_password: str

    @field_validator("username")
    @classmethod
    def username_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("must be at least 12 characters")
        return v


class SetupNodeRequest(BaseModel):
    name: str
    url: str
    proxmox_node: str
    verify_ssl: bool = True
    token_id: str = ""
    token_secret: str = ""

    @field_validator("url")
    @classmethod
    def valid_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("must start with http:// or https://")
        return v

    @field_validator("name", "proxmox_node")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()


class SetupTokensRequest(BaseModel):
    viewer_token_id: str = ""
    viewer_token_secret: str = ""
    operator_token_id: str = ""
    operator_token_secret: str = ""
    admin_token_id: str = ""
    admin_token_secret: str = ""
    # PROJ-55 Step 6: Packer-Token (optional, schreibt in dieselbe nodes-Zeile)
    packer_token_id: str = ""
    packer_token_secret: str = ""


class SetupPortalRequest(BaseModel):
    portal_name: str = "P3 Portal"
    packer_http_ip: str = ""


class TestConnectionRequest(BaseModel):
    url: str
    token_id: str
    token_secret: str
    verify_ssl: bool = True

    @field_validator("url")
    @classmethod
    def valid_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("must start with http:// or https://")
        return v


class TestNodeRequest(BaseModel):
    url: str
    verify_ssl: bool = True

    @field_validator("url")
    @classmethod
    def valid_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("must start with http:// or https://")
        return v


# ── PROJ-25: DB-Konfiguration ─────────────────────────────────────────────────

class SetupDatabaseRequest(BaseModel):
    db_type: str = Field("sqlite", pattern="^(sqlite|postgresql)$")
    # PostgreSQL-only fields (ignored when db_type = "sqlite")
    host: str = ""
    port: int = Field(5432, ge=1, le=65535)
    database: str = ""
    username: str = ""
    password: str = ""

    @field_validator("host", "database", "username", mode="before")
    @classmethod
    def strip_strings(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v


class SetupDatabaseTestRequest(BaseModel):
    host: str
    port: int = Field(5432, ge=1, le=65535)
    database: str
    username: str
    password: str

    @field_validator("host", "database", "username", mode="before")
    @classmethod
    def strip_strings(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v

    @field_validator("host", "database", "username")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("must not be empty")
        return v


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=SetupStatusResponse)
async def get_setup_status(
    _: str | None = Depends(_require_setup_access),
) -> SetupStatusResponse:
    """Public during setup; admin-only after setup (PROJ-67 Phase 1 – F-016)."""
    from backend.db.database import get_db
    from sqlalchemy import text

    setup_done = await is_setup_complete()

    has_admin = False
    try:
        from backend.db.database import get_db
        async with get_db() as session:
            result = await session.execute(
                text("SELECT COUNT(*) FROM local_users WHERE role = 'admin' AND active = 1")
            )
            has_admin = (result.scalar() or 0) > 0
    except Exception:
        pass

    has_node = (await count_nodes()) > 0

    setup_required = not setup_done or not has_admin or not has_node
    return SetupStatusResponse(
        setup_required=setup_required,
        has_admin=has_admin,
        has_node=has_node,
    )


@router.post("/test-connection")
async def test_proxmox_connection(
    body: TestConnectionRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Test a Proxmox connection without saving credentials."""
    return await test_connection(
        url=body.url,
        token_id=body.token_id,
        token_secret=body.token_secret,
        verify_ssl=body.verify_ssl,
    )


@router.post("/test-node")
async def test_node_reachability(
    body: TestNodeRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Check if a Proxmox URL is reachable via its public version endpoint.

    SSRF-hardening: the caller-supplied URL is resolved before the request,
    blocked address ranges (loopback, link-local incl. 169.254.169.254,
    multicast) are rejected, and the outgoing connection is pinned to the
    validated IP via Host-header rewrite to mitigate DNS-rebinding.
    Errors are returned in a generic form to avoid information leakage.
    """
    import logging
    from urllib.parse import urlparse

    from backend.core.http_client import (
        pin_url_to_ip,
        secure_outbound_client,
        validate_setup_target_url,
    )
    from backend.services.audit_service import write_audit_log

    log = logging.getLogger(__name__)
    url = body.url.rstrip("/")

    try:
        resolved_ip = validate_setup_target_url(url)
    except ValueError as exc:
        try:
            await write_audit_log(
                event_type="setup_target_blocked",
                username=None,
                auth_type=None,
                detail=f"test-node rejected: {exc}",
            )
        except Exception:
            pass
        return {"ok": False, "error": "target_address_blocked"}

    pinned_url, extra_headers = pin_url_to_ip(f"{url}/api2/json/version", resolved_ip)
    hostname = urlparse(url).hostname or ""

    try:
        async with secure_outbound_client(verify=body.verify_ssl, timeout=10.0) as client:
            r = await client.get(pinned_url, headers=extra_headers)
            # 401 = Proxmox antwortet, aber erfordert Auth → trotzdem erreichbar
            if r.status_code == 200:
                version = r.json().get("data", {}).get("version", None)
            elif r.status_code < 500:
                version = None
            else:
                return {"ok": False, "error": f"HTTP {r.status_code}"}
            return {"ok": True, "version": version}
    except Exception as exc:
        log.warning("test-node probe failed for host=%s: %s", hostname, exc)
        return {"ok": False, "error": "connection_failed"}


@router.post("/admin", status_code=201)
async def setup_admin(
    body: SetupAdminRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Create or update the initial admin account (Step 1)."""
    if body.password != body.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Passwords do not match",
        )
    from backend.services.local_auth import create_user, get_user_by_username, hash_password
    from backend.db.database import get_db
    from sqlalchemy import text

    existing = await get_user_by_username(body.username)
    if existing:
        # Update password of existing admin
        async with get_db() as session:
            await session.execute(
                text("UPDATE local_users SET password_hash = :ph WHERE username = :u"),
                {"ph": hash_password(body.password), "u": body.username},
            )
            await session.commit()
    else:
        await create_user(body.username, body.password, "admin")

    return {"ok": True, "username": body.username}


@router.post("/node", status_code=201)
async def setup_node(
    body: SetupNodeRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Save the first (default) Proxmox node (Step 2).

    Defense-in-depth: rejects URLs pointing to loopback / link-local
    (incl. IMDS) / multicast so an attacker cannot persist a malicious
    target during the unauthenticated setup window.
    """
    from backend.core.http_client import validate_setup_target_url
    from backend.services.audit_service import write_audit_log

    try:
        validate_setup_target_url(body.url)
    except ValueError as exc:
        try:
            await write_audit_log(
                event_type="setup_target_blocked",
                username=None,
                auth_type=None,
                detail=f"setup_node rejected: {exc}",
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target address blocked",
        )

    existing = await get_default_node()
    if existing:
        node = await update_node(
            existing.id,
            name=body.name,
            url=body.url,
            proxmox_node=body.proxmox_node,
            verify_ssl=body.verify_ssl,
            token_id=body.token_id,
            token_secret=body.token_secret,
        )
    else:
        node = await create_node(
            name=body.name,
            url=body.url,
            proxmox_node=body.proxmox_node,
            verify_ssl=body.verify_ssl,
            token_id=body.token_id,
            token_secret=body.token_secret,
            created_by="setup",
        )

    # Mirror to portal_config for ProxmoxClient (env-var fallback chain)
    await set_config("proxmox_host", body.url, is_secret=False, updated_by="setup")
    await set_config("proxmox_node", body.proxmox_node, is_secret=False, updated_by="setup")
    await set_config(
        "proxmox_verify_ssl",
        "true" if body.verify_ssl else "false",
        is_secret=False,
        updated_by="setup",
    )

    assert node is not None
    return {"ok": True, "node_id": node.id}


@router.post("/tokens")
async def setup_tokens(
    body: SetupTokensRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Save service-account tokens (Step 3) – writes into the default node."""
    node = await get_default_node()
    if not node:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Proxmox node configured yet – complete Step 2 first",
        )
    await update_node(
        node.id,
        viewer_token_id=body.viewer_token_id or None,
        viewer_token_secret=body.viewer_token_secret or None,
        operator_token_id=body.operator_token_id or None,
        operator_token_secret=body.operator_token_secret or None,
        admin_token_id=body.admin_token_id or None,
        admin_token_secret=body.admin_token_secret or None,
        packer_token_id=body.packer_token_id or None,
        packer_token_secret=body.packer_token_secret or None,
    )
    return {"ok": True}


@router.post("/portal-settings")
async def setup_portal_settings(
    body: SetupPortalRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Save portal name and Packer HTTP IP (Step 4)."""
    if body.portal_name:
        await set_config("portal_name", body.portal_name, is_secret=False, updated_by="setup")
    if body.packer_http_ip:
        await set_config("packer_http_ip", body.packer_http_ip, is_secret=False, updated_by="setup")
    return {"ok": True}


@router.get("/host-ip")
async def get_host_ip() -> dict:
    """Return the server's primary IP for auto-filling Builder HTTP IP."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        return {"ip": ip}
    except Exception:
        return {"ip": ""}


@router.get("/features")
async def get_public_features(
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Public during setup; admin-only after setup (PROJ-67 Phase 1 – F-016)."""
    val = await get_config("proxmox_login_enabled")
    return {"proxmox_login_enabled": val == "true"}


@router.post("/complete")
async def setup_complete(
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Mark setup as done (Step 7).

    PROJ-55 Option A: On the first successful completion (setup_complete false→true),
    mints a JWT for the initial admin and returns it so the frontend can skip the
    manual login step. Subsequent calls (re-run by authenticated admin) are already
    gated by _require_setup_access and return {ok: True} without a token.
    """
    has_node = (await count_nodes()) > 0
    if not has_node:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one Proxmox node must be configured before completing setup",
        )

    first_completion = not await is_setup_complete()
    await set_config("setup_complete", "true", is_secret=False, updated_by="setup")

    if not first_completion:
        # Re-run by already-authenticated admin – no token needed.
        return {"ok": True}

    # First completion: find the setup admin and issue a JWT for auto-login.
    from backend.db.database import get_db
    from backend.core.security import create_access_token
    from backend.services.audit_service import write_audit_log
    from sqlalchemy import text

    admin_username: str | None = None
    admin_permissions: list[str] = []
    try:
        async with get_db() as session:
            result = await session.execute(
                text(
                    "SELECT username, portal_permissions FROM local_users "
                    "WHERE role = 'admin' AND active = 1 "
                    "ORDER BY id ASC LIMIT 1"
                )
            )
            row = result.fetchone()
            if row:
                admin_username = row[0]
                raw_perms = row[1]
                if raw_perms:
                    import json as _json
                    try:
                        admin_permissions = _json.loads(raw_perms)
                    except Exception:
                        admin_permissions = []
    except Exception:
        pass

    if not admin_username:
        # Edge case: no admin found (shouldn't happen if /admin was called first).
        return {"ok": True}

    token = create_access_token(
        admin_username,
        auth_type="local",
        role="admin",
        portal_permissions=admin_permissions,
    )

    try:
        await write_audit_log(
            event_type="setup_admin_auto_login",
            username=admin_username,
            auth_type="local",
            detail="Auto-login JWT issued after setup completion",
        )
    except Exception:
        pass  # Audit failure must not block the setup flow.

    return {"ok": True, "access_token": token, "token_type": "bearer"}


# ── PROJ-25: Datenbankendpunkte ───────────────────────────────────────────────

@router.post("/database")
async def setup_database(
    body: SetupDatabaseRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Save DB configuration (Step 1).

    SQLite: resets to default (removes .db_config).
    PostgreSQL: writes postgresql+asyncpg URL into .db_config.
    Changes take effect after container restart.
    """
    from backend.services.db_config_service import build_postgres_url, write_db_config
    from pathlib import Path

    data_dir = _settings.data_dir
    config_path = Path(data_dir) / ".db_config"

    if body.db_type == "sqlite":
        if config_path.exists():
            config_path.unlink()
        return {"ok": True, "db_type": "sqlite", "restart_required": True}

    # PostgreSQL – validate required fields
    for field_name in ("host", "database", "username"):
        if not getattr(body, field_name):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{field_name} is required for PostgreSQL",
            )

    db_url = build_postgres_url(
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=body.password,
    )
    write_db_config(data_dir, db_url)
    return {"ok": True, "db_type": "postgresql", "restart_required": True}


@router.post("/database/test")
async def test_database_connection(
    body: SetupDatabaseTestRequest,
    _: str | None = Depends(_require_setup_access),
) -> dict:
    """Test a PostgreSQL connection without saving credentials (timeout: 5 s)."""
    import asyncio
    from backend.services.db_config_service import build_postgres_url

    db_url = build_postgres_url(
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=body.password,
    )

    try:
        from sqlalchemy import text as sa_text
        from sqlalchemy.ext.asyncio import create_async_engine
        engine = create_async_engine(db_url, echo=False, pool_timeout=5, connect_args={"timeout": 5})
        try:
            async def _check():
                async with engine.connect() as conn:
                    await conn.execute(sa_text("SELECT 1"))
            await asyncio.wait_for(_check(), timeout=5.0)
            return {"ok": True, "message": "Verbindung erfolgreich"}
        finally:
            await engine.dispose()
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Verbindung fehlgeschlagen: Timeout nach 5 Sekunden",
        )
    except Exception as exc:
        error_msg = str(exc)
        # Strip connection URL from error to avoid leaking credentials
        if "@" in error_msg:
            error_msg = error_msg.split("@")[-1]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Verbindung fehlgeschlagen: {error_msg}",
        )
