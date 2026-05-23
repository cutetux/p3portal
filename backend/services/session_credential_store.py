# p3portal.org
"""PROJ-22: In-memory credential store for Proxmox-login sessions.

Passwords are Fernet-encrypted in RAM; never written to disk or DB.
Keyed by JWT JTI – cleared on logout and lost on container restart.
"""
from __future__ import annotations

# jti → {"username": str, "realm": str, "password_enc": bytes}
_store: dict[str, dict] = {}


def store_credentials(jti: str, username: str, password: str, realm: str) -> None:
    from backend.services.config_service import _fernet
    enc = _fernet().encrypt(password.encode())
    _store[jti] = {"username": username, "realm": realm, "password_enc": enc}


def get_credentials(jti: str) -> dict | None:
    """Return {"username": str, "realm": str, "password": str} or None."""
    entry = _store.get(jti)
    if not entry:
        return None
    from backend.services.config_service import _fernet
    password = _fernet().decrypt(entry["password_enc"]).decode()
    return {"username": entry["username"], "realm": entry["realm"], "password": password}


def clear_credentials(jti: str) -> None:
    _store.pop(jti, None)
