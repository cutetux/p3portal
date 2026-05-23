# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Secret-Maskierung und Fernet-Roundtrip für Approval-Payloads.

Workflow beim Antrag-Erzeugen:
  1. split_payload(original_payload, meta_sensitive_fields)
     → (public_payload, secret_dict)
  2. encrypt_secrets(secret_dict) → encrypted_blob (store in DB)

Workflow beim Approve (Execute):
  1. decrypt_secrets(encrypted_blob) → secret_dict
  2. merge_payload(public_payload, secret_dict) → full_payload for handler
  3. Nach Ausführung: blob in DB auf NULL setzen (done by service)
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
from typing import Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

# Feldnamen die auto-erkannt als sensitiv gelten (case-insensitive substring match)
_SENSITIVE_SUBSTRINGS = frozenset({
    "password", "passwd", "kennwort", "passwort",
    "ssh_key", "private_key", "token", "secret", "geheim",
})

# meta.yaml Feldtypen die als sensitiv gelten
_SENSITIVE_TYPES = frozenset({"password", "ssh_key", "secret"})

_MASKED = "__secret__"
_fernet_instance: Fernet | None = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        from backend.core.config import settings
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"p3portal_approvals_v1",
            iterations=200_000,
        )
        raw = kdf.derive(settings.secret_key.encode())
        _fernet_instance = Fernet(base64.urlsafe_b64encode(raw))
    return _fernet_instance


def _is_sensitive_field(
    field_name: str,
    meta_field: dict | None = None,
) -> bool:
    """Prüft ob ein Feld als sensitiv gilt."""
    name_lower = field_name.lower()
    for substr in _SENSITIVE_SUBSTRINGS:
        if substr in name_lower:
            return True
    if meta_field:
        if meta_field.get("type") in _SENSITIVE_TYPES:
            return True
        if meta_field.get("sensitive"):
            return True
    return False


def split_payload(
    payload: dict[str, Any],
    meta_fields: list[dict] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Trennt public (maskiert) und secret (Klartext) Anteile des Payloads.

    Returns:
        (public_payload, secret_dict)
        public_payload: wie original, aber sensitive Werte durch __secret__ ersetzt
        secret_dict:    {field_name: clear_value} aller sensitiven Felder
    """
    meta_map: dict[str, dict] = {}
    if meta_fields:
        for f in meta_fields:
            if isinstance(f, dict) and f.get("id"):
                meta_map[f["id"]] = f

    public: dict[str, Any] = {}
    secrets: dict[str, Any] = {}

    for key, value in payload.items():
        meta_f = meta_map.get(key)
        if _is_sensitive_field(key, meta_f) and value is not None and value != "":
            public[key] = _MASKED
            secrets[key] = value
        else:
            public[key] = value

    return public, secrets


def encrypt_secrets(secret_dict: dict[str, Any]) -> str | None:
    """Verschlüsselt das Secret-Dict mit Fernet. Gibt None zurück wenn leer."""
    if not secret_dict:
        return None
    plaintext = json.dumps(secret_dict).encode()
    return _fernet().encrypt(plaintext).decode()


def decrypt_secrets(blob: str) -> dict[str, Any]:
    """Entschlüsselt einen Fernet-verschlüsselten Secret-Blob."""
    try:
        plaintext = _fernet().decrypt(blob.encode())
        return json.loads(plaintext)
    except Exception as exc:
        logger.error("PROJ-50: Fernet-Entschlüsselung fehlgeschlagen: %s", exc)
        return {}


def merge_payload(
    public_payload: dict[str, Any],
    secret_dict: dict[str, Any],
) -> dict[str, Any]:
    """Merged öffentlichen Payload mit entschlüsselten Secrets zurück."""
    merged = dict(public_payload)
    merged.update(secret_dict)
    return merged


def payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 über den kanonisch sortierten Payload (für Audit-Vergleich)."""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def mask_payload_for_display(payload: dict[str, Any]) -> dict[str, Any]:
    """Ersetzt __secret__-Marker durch UI-freundliche Darstellung (bleibt __secret__)."""
    return payload


def reset_fernet_cache() -> None:
    """Für Tests: Fernet-Instanz zurücksetzen."""
    global _fernet_instance
    _fernet_instance = None
