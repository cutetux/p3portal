# p3portal.org
"""PROJ-67 Phase 1 – F-005: Body-Maskierung für Proxmox-Audit-Log.

Zentrale Maskierungs-Funktionen, die von proxmox_audit_service verwendet werden.
Bereit für Wiederverwendung in Phase 2 (Log-Injection-Schutz safe_log_field).
"""
from __future__ import annotations

import json
import re

# Regex für URL-encoded Form-Felder (z.B. Proxmox /access/ticket POST-Body)
_FORM_FIELD_RE = re.compile(
    r"(?i)(password|passwd|kennwort)\s*=\s*([^&\s]+)"
)

# JSON-Schlüssel die Secrets enthalten können
_SECRET_JSON_KEYS = frozenset(
    {"password", "passwd", "kennwort", "secret", "token"}
)


def mask_sensitive_body(body: str) -> str:
    """Maskiert Passwörter und Secrets in einem Body-String.

    Erkennt URL-encoded Form-Felder (password=xxx) und JSON-Werte
    für bekannte Secret-Schlüssel.
    """
    if not body:
        return body

    # URL-encoded form-field masking
    masked = _FORM_FIELD_RE.sub(r"\1=<redacted>", body)

    # JSON masking: nur wenn es wie JSON aussieht
    if masked.strip().startswith(("{", "[")):
        try:
            data = json.loads(masked)
            masked = json.dumps(_mask_json_obj(data))
        except (json.JSONDecodeError, TypeError):
            pass

    return masked


def _mask_json_obj(obj: object) -> object:
    """Rekursiv alle JSON-Objekte nach Secret-Schlüsseln durchsuchen."""
    if isinstance(obj, dict):
        return {
            k: "<redacted>" if k.lower() in _SECRET_JSON_KEYS else _mask_json_obj(v)
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_mask_json_obj(item) for item in obj]
    return obj


def mask_login_body(path: str, body: str) -> str:
    """Ersetzt den Body für /access/ticket-Calls komplett (Login-Schutz).

    Alle anderen Paths werden durch mask_sensitive_body verarbeitet.
    """
    if path and path.rstrip("/").endswith("/access/ticket"):
        return "<login-body-redacted>"
    return mask_sensitive_body(body)


def safe_log_field(value: str) -> str:
    """Entfernt Log-Injection-Zeichen aus einem Feld-Wert.

    Ersetzt CR, LF, TAB durch URL-Style-Escape-Sequenzen.
    Vorbereitung für Phase 2 (AC-F-018 Log-Injection-Schutz).
    """
    if not value:
        return value
    return (
        value
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t")
    )
