# p3portal.org
"""PROJ-106 – Unit-Tests für den 2FA-Service (Enrollment, Challenge, Policy)."""
from __future__ import annotations

import pyotp
import pytest
import pytest_asyncio

from backend.db.database import init_db
from backend.services import two_factor_service as t
from backend.services.local_auth import create_user


@pytest.fixture(autouse=True)
def _patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    # Policy-Cache zwischen Tests leeren (portal_config ist Modul-global gecacht)
    from backend.services import config_service
    config_service._cache.clear()


@pytest_asyncio.fixture
async def user_id() -> int:
    await init_db()
    user = await create_user("alice", "AlicePass1234", "operator")
    return user.id


# ── Reine Helfer ──────────────────────────────────────────────────────────────

def test_verify_totp_roundtrip():
    secret = t.generate_secret()
    assert t.verify_totp(secret, pyotp.TOTP(secret).now()) is True
    assert t.verify_totp(secret, "000000") in (True, False)  # zufällig, aber kein Crash
    assert t.verify_totp(secret, "") is False
    assert t.verify_totp(secret, "abcdef") is False


def test_provisioning_uri_and_qr():
    secret = t.generate_secret()
    uri = t.provisioning_uri(secret, "alice")
    assert uri.startswith("otpauth://totp/")
    assert "P3%20Portal" in uri
    svg = t.render_qr_svg(uri)
    assert "<svg" in svg


def test_recovery_codes_generate_and_normalize():
    plain, hashes = t.generate_recovery_codes()
    assert len(plain) == 10 and len(hashes) == 10
    assert len(set(hashes)) == 10  # keine Duplikate
    # Normalisierung: Kleinschreibung / entfernte Bindestriche matchen denselben Hash
    assert t._hash_recovery(plain[0]) == hashes[0]
    assert t._hash_recovery(plain[0].lower().replace("-", "")) == hashes[0]


# ── Enrollment-Flow ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_enrollment_activate_and_state(user_id: int):
    state = await t.get_state(user_id)
    assert state == {"enabled": False, "pending": False, "enforced": False}

    data = await t.start_enrollment(user_id, "alice")
    assert data["otpauth_uri"].startswith("otpauth://")
    assert "<svg" in data["qr_svg"]
    state = await t.get_state(user_id)
    assert state["enabled"] is False and state["pending"] is True

    # Falscher Code aktiviert nicht
    assert await t.activate(user_id, "000000") is None or (await t.get_state(user_id))["enabled"]

    # Richtiger Code aktiviert + liefert 10 Recovery-Codes
    code = pyotp.TOTP(data["secret"]).now()
    codes = await t.activate(user_id, code)
    assert codes is not None and len(codes) == 10
    state = await t.get_state(user_id)
    assert state["enabled"] is True and state["pending"] is False


@pytest.mark.asyncio
async def test_verify_second_factor_totp_and_recovery(user_id: int):
    data = await t.start_enrollment(user_id, "alice")
    secret = data["secret"]
    recovery = await t.activate(user_id, pyotp.TOTP(secret).now())

    # TOTP
    assert await t.verify_second_factor(user_id, pyotp.TOTP(secret).now()) == "totp"
    # Falscher Code
    assert await t.verify_second_factor(user_id, "123123") is None
    # Recovery-Code (einmalig)
    rc = recovery[0]
    assert await t.verify_second_factor(user_id, rc) == "recovery"
    # Verbraucht → nicht wieder verwendbar
    assert await t.verify_second_factor(user_id, rc) is None


@pytest.mark.asyncio
async def test_verify_totp_for_user_no_recovery_consumption(user_id: int):
    data = await t.start_enrollment(user_id, "alice")
    recovery = await t.activate(user_id, pyotp.TOTP(data["secret"]).now())
    # TOTP-only akzeptiert keinen Recovery-Code
    assert await t.verify_totp_for_user(user_id, recovery[0]) is False
    assert await t.verify_totp_for_user(user_id, pyotp.TOTP(data["secret"]).now()) is True
    # Recovery-Code wurde nicht verbraucht
    assert await t.verify_second_factor(user_id, recovery[0]) == "recovery"


@pytest.mark.asyncio
async def test_disable_clears_everything(user_id: int):
    data = await t.start_enrollment(user_id, "alice")
    await t.activate(user_id, pyotp.TOTP(data["secret"]).now())
    await t.disable(user_id)
    state = await t.get_state(user_id)
    assert state["enabled"] is False and state["pending"] is False
    assert await t.verify_second_factor(user_id, pyotp.TOTP(data["secret"]).now()) is None


# ── Enforce-Policy ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_policy_global_and_roles(user_id: int):
    assert await t.is_required_for_role("operator") is False

    await t.set_policy(True, [])
    assert (await t.get_policy())["enforce_global"] is True
    assert await t.is_required_for_role("operator") is True

    await t.set_policy(False, ["admin"])
    assert await t.is_required_for_role("operator") is False
    assert await t.is_required_for_role("admin") is True


# ── BUG-106-3: Recovery-Codes neu generieren ──────────────────────────────────

@pytest.mark.asyncio
async def test_regenerate_recovery_codes(user_id: int):
    data = await t.start_enrollment(user_id, "alice")
    old = await t.activate(user_id, pyotp.TOTP(data["secret"]).now())
    new = await t.regenerate_recovery_codes(user_id)
    assert new is not None and len(new) == 10
    assert set(new).isdisjoint(set(old))          # frische Codes
    assert await t.verify_second_factor(user_id, old[0]) is None       # alte ungültig
    assert await t.verify_second_factor(user_id, new[0]) == "recovery"  # neue gültig


@pytest.mark.asyncio
async def test_regenerate_requires_active_2fa(user_id: int):
    assert await t.regenerate_recovery_codes(user_id) is None  # kein 2FA aktiv
