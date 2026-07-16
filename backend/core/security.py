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
    must_setup_2fa: bool = False,
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
    # PROJ-106: Enforce-pflichtiger Nutzer ohne 2FA → Frontend erzwingt Enrollment
    if must_setup_2fa:
        payload["must_setup_2fa"] = True
    # Keep proxmox_user for backward compat with existing Proxmox tokens
    if auth_type == "proxmox":
        payload["proxmox_user"] = subject
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


# PROJ-106: Lebensdauer des Pre-Auth-("Halb"-)Tokens für die 2FA-Challenge.
PRE_AUTH_TTL_MINUTES = 5


def create_pre_auth_token(subject: str) -> str:
    """Kurzlebiges Zwischen-Token nach korrektem Passwort, wenn 2FA aktiv ist.

    Trägt ``stage="2fa"`` und öffnet KEINE geschützte Route (get_current_user
    weist es ab). Nur der Challenge-Endpunkt (/auth/login/2fa) akzeptiert es.
    Zustandslos (kein Session-Eintrag), eigener jti für Fehlversuchs-Drosselung.
    """
    import uuid as _uuid

    expire = datetime.now(timezone.utc) + timedelta(minutes=PRE_AUTH_TTL_MINUTES)
    payload = {
        "sub": subject,
        "stage": "2fa",
        "exp": expire,
        "jti": str(_uuid.uuid4()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jose.JWTError on invalid or expired token."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
