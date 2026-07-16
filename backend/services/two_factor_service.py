# p3portal.org
"""PROJ-106 – Zwei-Faktor-Authentifizierung (TOTP) für lokale P3-User.

Kern-Logik für Enrollment, Login-Challenge, Recovery-Codes und die
Enforce-Richtlinie. Bewusst scope-begrenzt auf ``auth_type == "local"`` –
Proxmox-Login existiert nicht mehr, SSO-User (PROJ-107) machen MFA beim IdP.

At-rest:
  - TOTP-Secret (aktiv + pending) Fernet-verschlüsselt (config_service._fernet,
    Ableitung aus SECRET_KEY) in ``local_users.totp_secret`` / ``totp_pending_secret``.
  - Recovery-Codes NUR als SHA-256-Hashes (JSON-Array) in ``totp_recovery_codes``;
    Klartext wird nur einmal bei Erzeugung zurückgegeben.

Enforce-Policy in ``portal_config``:
  - ``2fa_enforce_global`` = "true"/"false"
  - ``2fa_enforce_roles``  = JSON-Array von Rollennamen (z. B. ["admin"]).
"""
from __future__ import annotations

import hashlib
import io
import json
import secrets

import pyotp
import qrcode
import qrcode.image.svg
from sqlalchemy import text

from backend.db.database import get_db
from backend.services.config_service import decrypt_secret, encrypt_secret, get_config, set_config

# ── Konstanten ────────────────────────────────────────────────────────────────
_ISSUER = "P3 Portal"
_RECOVERY_COUNT = 10
_RECOVERY_GROUP = 5          # Zeichen je Gruppe → "ABCDE-FGHJK"
# Verwechslungsarmes Alphabet (kein 0/O/1/I/L)
_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_VALID_WINDOW = 1            # ±1 Schritt (±30 s) gegen Uhren-Drift

POLICY_KEY_GLOBAL = "2fa_enforce_global"
POLICY_KEY_ROLES = "2fa_enforce_roles"


# ── Reine TOTP-/QR-Helfer ─────────────────────────────────────────────────────

def generate_secret() -> str:
    """Neues Base32-TOTP-Secret (Klartext)."""
    return pyotp.random_base32()


def provisioning_uri(secret: str, username: str) -> str:
    """otpauth://-URI für Authenticator-Apps."""
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=_ISSUER)


def render_qr_svg(data: str) -> str:
    """Rendert die otpauth-URI als eigenständiges SVG (ohne Pillow)."""
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")


def verify_totp(secret: str, code: str) -> bool:
    """Prüft einen 6-stelligen TOTP-Code mit ±1-Schritt-Toleranz."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit():
        return False
    try:
        return pyotp.TOTP(secret).verify(code, valid_window=_VALID_WINDOW)
    except Exception:
        return False


# ── Recovery-Codes ────────────────────────────────────────────────────────────

def _normalize_recovery(code: str) -> str:
    return code.strip().upper().replace("-", "").replace(" ", "")


def _hash_recovery(code: str) -> str:
    return hashlib.sha256(_normalize_recovery(code).encode("utf-8")).hexdigest()


def generate_recovery_codes() -> tuple[list[str], list[str]]:
    """Erzeugt (Klartext-Codes, Hashes). Klartext nur einmalig anzeigbar."""
    plain: list[str] = []
    for _ in range(_RECOVERY_COUNT):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_GROUP * 2))
        plain.append(f"{raw[:_RECOVERY_GROUP]}-{raw[_RECOVERY_GROUP:]}")
    hashes = [_hash_recovery(c) for c in plain]
    return plain, hashes


# ── DB-Helfer (intern) ────────────────────────────────────────────────────────

async def _load_row(user_id: int) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT id, username, role, active, totp_secret, totp_pending_secret, "
                "totp_enabled, totp_recovery_codes FROM local_users WHERE id = :id"
            ),
            {"id": user_id},
        )
        row = result.mappings().fetchone()
    return dict(row) if row else None


def _decrypt(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return decrypt_secret(value)
    except Exception:
        return None


# ── Enrollment (Selbstbedienung) ──────────────────────────────────────────────

async def get_state(user_id: int) -> dict:
    """2FA-Status eines Nutzers (aktiv? Enrollment offen? enforce-pflichtig?)."""
    row = await _load_row(user_id)
    enabled = bool(row and row.get("totp_enabled"))
    has_pending = bool(row and row.get("totp_pending_secret"))
    enforced = await is_required_for_role(row["role"]) if row else False
    return {"enabled": enabled, "pending": has_pending, "enforced": enforced}


async def start_enrollment(user_id: int, username: str) -> dict:
    """Erzeugt ein pending-Secret und liefert otpauth-URI + QR-SVG.

    Überschreibt ein evtl. schon vorhandenes, unbestätigtes pending-Secret –
    ein aktives 2FA bleibt unberührt, bis der neue Code bestätigt wird.
    """
    secret = generate_secret()
    uri = provisioning_uri(secret, username)
    svg = render_qr_svg(uri)
    async with get_db() as session:
        await session.execute(
            text("UPDATE local_users SET totp_pending_secret = :s WHERE id = :id"),
            {"s": encrypt_secret(secret), "id": user_id},
        )
        await session.commit()
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": svg}


async def activate(user_id: int, code: str) -> list[str] | None:
    """Bestätigt das pending-Secret gegen ``code``. Bei Erfolg: aktivieren,
    Recovery-Codes erzeugen, pending leeren. Gibt die Klartext-Recovery-Codes
    zurück (einmalig), sonst None."""
    row = await _load_row(user_id)
    if not row:
        return None
    pending = _decrypt(row.get("totp_pending_secret"))
    if not pending or not verify_totp(pending, code):
        return None
    plain, hashes = generate_recovery_codes()
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE local_users SET totp_secret = :s, totp_pending_secret = NULL, "
                "totp_enabled = 1, totp_recovery_codes = :rc WHERE id = :id"
            ),
            {"s": encrypt_secret(pending), "rc": json.dumps(hashes), "id": user_id},
        )
        await session.commit()
    return plain


async def regenerate_recovery_codes(user_id: int) -> list[str] | None:
    """Erzeugt frische Recovery-Codes für ein aktives 2FA (invalidiert die alten).
    Gibt die Klartext-Codes einmalig zurück, sonst None (2FA nicht aktiv)."""
    row = await _load_row(user_id)
    if not row or not row.get("totp_enabled"):
        return None
    plain, hashes = generate_recovery_codes()
    async with get_db() as session:
        await session.execute(
            text("UPDATE local_users SET totp_recovery_codes = :rc WHERE id = :id"),
            {"rc": json.dumps(hashes), "id": user_id},
        )
        await session.commit()
    return plain


async def disable(user_id: int) -> None:
    """Deaktiviert 2FA und löscht alle 2FA-Artefakte (Secret/pending/Recovery)."""
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE local_users SET totp_secret = NULL, totp_pending_secret = NULL, "
                "totp_enabled = 0, totp_recovery_codes = NULL WHERE id = :id"
            ),
            {"id": user_id},
        )
        await session.commit()


# admin_reset ist bewusst identisch zu disable (klarere Aufruf-Semantik/Audit).
async def admin_reset(user_id: int) -> None:
    await disable(user_id)


# ── Login-Challenge ───────────────────────────────────────────────────────────

async def verify_totp_for_user(user_id: int, code: str) -> bool:
    """Prüft NUR den aktuellen TOTP-Code (kein Recovery-Verbrauch) – z. B. zum
    Bestätigen einer Deaktivierung."""
    row = await _load_row(user_id)
    if not row or not row.get("totp_enabled"):
        return False
    secret = _decrypt(row.get("totp_secret"))
    return bool(secret and verify_totp(secret, code))


async def verify_second_factor(user_id: int, code: str) -> str | None:
    """Prüft den 2. Faktor beim Login. Reihenfolge: TOTP, dann Recovery-Code.

    Ein akzeptierter Recovery-Code wird sofort verbraucht (aus der Liste
    entfernt). Rückgabe: "totp" | "recovery" | None.
    """
    row = await _load_row(user_id)
    if not row or not row.get("totp_enabled"):
        return None
    secret = _decrypt(row.get("totp_secret"))
    if secret and verify_totp(secret, code):
        return "totp"
    # Recovery-Fallback
    try:
        hashes: list[str] = json.loads(row.get("totp_recovery_codes") or "[]")
    except Exception:
        hashes = []
    candidate = _hash_recovery(code)
    if candidate in hashes:
        hashes.remove(candidate)
        async with get_db() as session:
            await session.execute(
                text("UPDATE local_users SET totp_recovery_codes = :rc WHERE id = :id"),
                {"rc": json.dumps(hashes), "id": user_id},
            )
            await session.commit()
        return "recovery"
    return None


# ── Enforce-Richtlinie (portalweit, portal_config) ────────────────────────────

async def get_policy() -> dict:
    """Aktuelle Enforce-Richtlinie: {enforce_global: bool, enforce_roles: [...]}"""
    g = await get_config(POLICY_KEY_GLOBAL)
    r = await get_config(POLICY_KEY_ROLES)
    try:
        roles = json.loads(r) if r else []
    except Exception:
        roles = []
    return {"enforce_global": (g or "").lower() == "true", "enforce_roles": roles}


async def set_policy(enforce_global: bool, enforce_roles: list[str], updated_by: str = "system") -> None:
    await set_config(POLICY_KEY_GLOBAL, "true" if enforce_global else "false", updated_by=updated_by)
    await set_config(POLICY_KEY_ROLES, json.dumps(list(dict.fromkeys(enforce_roles))), updated_by=updated_by)


async def is_required_for_role(role: str) -> bool:
    """True, wenn 2FA für diese Rolle Pflicht ist (global ODER Rollen-Liste)."""
    policy = await get_policy()
    return bool(policy["enforce_global"] or role in policy["enforce_roles"])
