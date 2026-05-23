# p3portal.org
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from backend.core.config import settings


def create_access_token(
    subject: str,
    auth_type: str = "local",
    role: str = "operator",
    jti: str | None = None,
    must_change_pw: bool = False,
    portal_permissions: list[str] | None = None,
) -> str:
    import uuid as _uuid

    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {
        "sub": subject,
        "auth_type": auth_type,
        "role": role,
        "exp": expire,
        "jti": jti or str(_uuid.uuid4()),
        "portal_permissions": portal_permissions or [],
    }
    if must_change_pw:
        payload["must_change_pw"] = True
    # Keep proxmox_user for backward compat with existing Proxmox tokens
    if auth_type == "proxmox":
        payload["proxmox_user"] = subject
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jose.JWTError on invalid or expired token."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
