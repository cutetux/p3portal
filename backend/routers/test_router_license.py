# p3portal.org
"""PROJ-17: Tests for GET /api/license/status and license.py crypto logic."""
from __future__ import annotations

import base64
import hashlib
import hmac as _hmac
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.license import (
    VENDOR_SALT,
    _PLUS_TOKEN,
    _aes_gcm_decrypt,
    _mac_payload,
    LicenseStatus,
    get_license_status,
    is_plus_edition,
    reset_license_cache,
)
from backend.core.config import settings as _settings
from backend.core.security import create_access_token
from backend.routers.license import router
from backend.routers.auth import router as auth_router

app = FastAPI()
app.include_router(auth_router)
app.include_router(router)

_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _aes_gcm_encrypt(plaintext: bytes, key: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, None)


def _derive_customer_secret(license_id: str) -> bytes:
    return _hmac.new(VENDOR_SALT, license_id.encode("utf-8"), hashlib.sha256).digest()


def _make_license_files(
    tmp_path: Path,
    *,
    license_id: str = "P3-2026-00001",
    expiry: str | None = None,
    edition: str = "plus_v1",
    corrupt_key: bool = False,
    missing_key_field: bool = False,
    contact_name: str = "Test User",
    contact_email: str = "test@example.com",
    master_key: bytes | None = None,
) -> tuple[Path, Path]:
    """Returns (lic_path, enc_path) for test setup."""
    if master_key is None:
        master_key = os.urandom(32)
    if expiry is None:
        expiry = (date.today() + timedelta(days=365)).isoformat()

    # plus.enc
    enc_data = _aes_gcm_encrypt(_PLUS_TOKEN, master_key)
    enc_path = tmp_path / "plus.enc"
    enc_path.write_bytes(enc_data)

    # key_field
    if corrupt_key:
        key_b64 = base64.b64encode(os.urandom(60)).decode()
    elif missing_key_field:
        key_b64 = None
    else:
        customer_secret = _derive_customer_secret(license_id)
        key_b64 = base64.b64encode(_aes_gcm_encrypt(master_key, customer_secret)).decode()

    lic: dict = {
        "license_id":    license_id,
        "contact_name":  contact_name,
        "contact_email": contact_email,
        "edition":       edition,
        "issued":        date.today().isoformat(),
        "expiry":        expiry,
    }
    if not missing_key_field:
        lic["key"] = key_b64
        # MAC over tamper-sensitive fields (only when key is present and not corrupt)
        if not corrupt_key:
            payload = _mac_payload(license_id, edition, expiry, contact_name, contact_email)
            lic["mac"] = _hmac.new(master_key, payload, hashlib.sha256).hexdigest()

    lic_path = tmp_path / "plus.lic"
    lic_path.write_text(json.dumps(lic))

    return lic_path, enc_path


@pytest.fixture(autouse=True)
def clear_cache():
    """Reset the module-level license cache before every test."""
    reset_license_cache()
    yield
    reset_license_cache()


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client(tmp_path):
    from backend.db.database import init_db
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Unit tests: get_license_status() / is_plus_edition()
# ---------------------------------------------------------------------------

def test_core_when_no_lic_file(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "plus_license_path", str(tmp_path / "plus.lic"))
    monkeypatch.setattr(settings, "plus_enc_path", str(tmp_path / "plus.enc"))

    status = get_license_status()
    assert status.edition == "core"
    assert status.valid is False
    assert status.reason == "missing"
    assert is_plus_edition() is False


def test_valid_plus_license(tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is True
    assert status.edition == "plus_v1"
    assert status.reason is None
    assert status.contact_name == "Test User"
    assert status.contact_email == "test@example.com"
    assert is_plus_edition() is True


def test_plus_v2_edition(tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path, edition="plus_v2")
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is True
    assert status.edition == "plus_v2"


def test_backward_compat_basis_edition_normalized_to_core(tmp_path, monkeypatch):
    """AC-12/AC-14 (PROJ-53): A license JSON with edition='basis' is accepted and
    normalized to 'core'. MAC verification runs over the original 'basis' string so
    the HMAC check does not fail — only the returned LicenseStatus.edition is rewritten.

    This test MUST keep edition='basis' to exercise the backward-compat code path;
    do NOT rename it to 'core'. See PROJ-53 spec, AC-14.
    """
    from backend.core.config import settings
    # _make_license_files computes MAC with edition='basis' in the payload
    lic_path, enc_path = _make_license_files(tmp_path, edition="basis")
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    # MAC was verified with original 'basis' string → valid=True
    assert status.valid is True
    # PROJ-53: edition is normalized from 'basis' → 'core' after MAC verification
    assert status.edition == "core"
    # is_plus_edition() checks valid, not edition string
    assert is_plus_edition() is True


def test_expired_license(tmp_path, monkeypatch):
    from backend.core.config import settings
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    lic_path, enc_path = _make_license_files(tmp_path, expiry=yesterday)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "expired"
    assert status.edition == "plus_v1"


def test_expiry_today_is_still_valid(tmp_path, monkeypatch):
    from backend.core.config import settings
    today = date.today().isoformat()
    lic_path, enc_path = _make_license_files(tmp_path, expiry=today)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is True


def test_corrupted_key_field(tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path, corrupt_key=True)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "decryption_failed"


def test_missing_key_field_in_lic(tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path, missing_key_field=True)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "decryption_failed"


def test_malformed_json_lic(tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path = tmp_path / "plus.lic"
    lic_path.write_text("{not valid json")
    enc_path = tmp_path / "plus.enc"
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "decryption_failed"


def test_missing_plus_enc(tmp_path, monkeypatch):
    """plus.lic present + valid key but plus.enc missing → deployment error."""
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path)
    enc_path.unlink()  # simulate missing plus.enc
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "decryption_failed"


def test_wrong_master_key_for_plus_enc(tmp_path, monkeypatch):
    """key_field decrypts to a random value, not the real master_key → token mismatch."""
    from backend.core.config import settings

    master_key_real  = os.urandom(32)
    master_key_wrong = os.urandom(32)  # used to build plus.enc

    # plus.enc built with wrong master_key
    enc_path = tmp_path / "plus.enc"
    enc_path.write_bytes(_aes_gcm_encrypt(_PLUS_TOKEN, master_key_wrong))

    # plus.lic wraps the REAL master_key (correct lic, wrong enc)
    license_id = "P3-2026-00001"
    customer_secret = _derive_customer_secret(license_id)
    key_b64 = base64.b64encode(_aes_gcm_encrypt(master_key_real, customer_secret)).decode()
    lic = {
        "license_id":    license_id,
        "contact_name":  "Test",
        "contact_email": "test@example.com",
        "edition":       "plus_v1",
        "issued":        date.today().isoformat(),
        "expiry":        (date.today() + timedelta(days=365)).isoformat(),
        "key":           key_b64,
    }
    lic_path = tmp_path / "plus.lic"
    lic_path.write_text(json.dumps(lic))

    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "decryption_failed"


def test_license_cached_after_first_call(tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    s1 = get_license_status()
    s2 = get_license_status()
    assert s1 is s2  # same object → cached


# ---------------------------------------------------------------------------
# API tests: GET /api/license/status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_api_core_no_lic(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "plus_license_path", str(tmp_path / "plus.lic"))
    monkeypatch.setattr(settings, "plus_enc_path", str(tmp_path / "plus.enc"))

    resp = await client.get("/api/license/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["edition"] == "core"
    assert data["valid"] is False
    assert data["reason"] == "missing"
    assert data["contact_name"] is None


@pytest.mark.asyncio
async def test_api_valid_plus(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(
        tmp_path, contact_name="Acme GmbH", contact_email="admin@acme.de"
    )
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    resp = await client.get("/api/license/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["edition"] == "plus_v1"
    assert data["reason"] is None
    assert data["contact_name"] == "Acme GmbH"
    assert "contact_email" not in data  # admin-only endpoint
    assert data["expiry"] is not None


@pytest.mark.asyncio
async def test_api_expired_license(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    lic_path, enc_path = _make_license_files(tmp_path, expiry=yesterday)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    resp = await client.get("/api/license/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False
    assert data["reason"] == "expired"


@pytest.mark.asyncio
async def test_api_never_returns_500(client: AsyncClient, tmp_path, monkeypatch):
    """Even with a corrupted lic file, the endpoint must not crash."""
    from backend.core.config import settings
    lic = tmp_path / "plus.lic"
    lic.write_text("{bad json!!!")
    monkeypatch.setattr(settings, "plus_license_path", str(lic))
    monkeypatch.setattr(settings, "plus_enc_path", str(tmp_path / "plus.enc"))

    resp = await client.get("/api/license/status")
    assert resp.status_code == 200
    assert "reason" in resp.json()


@pytest.mark.asyncio
async def test_api_no_auth_required(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "plus_license_path", str(tmp_path / "plus.lic"))
    monkeypatch.setattr(settings, "plus_enc_path", str(tmp_path / "plus.enc"))

    resp = await client.get("/api/license/status")
    assert resp.status_code == 200  # no Authorization header → still OK


# ---------------------------------------------------------------------------
# PROJ-20: limits field in /api/license/status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_limits_present_in_core_response(client, tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "plus_license_path", str(tmp_path / "plus.lic"))
    monkeypatch.setattr(settings, "plus_enc_path", str(tmp_path / "plus.enc"))

    resp = await client.get("/api/license/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "limits" in data
    limits = data["limits"]
    assert "users" in limits
    assert "presets" in limits
    assert limits["users"]["unlimited"] is False
    assert limits["users"]["max"] == 6
    assert limits["users"]["current"] == 0
    assert limits["presets"]["unlimited"] is False
    assert limits["presets"]["max"] == 5
    assert limits["presets"]["current"] == 0


@pytest.mark.asyncio
async def test_limits_current_reflects_db(client, tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "plus_license_path", str(tmp_path / "plus.lic"))
    monkeypatch.setattr(settings, "plus_enc_path", str(tmp_path / "plus.enc"))
    from backend.services.local_auth import create_user
    from backend.services.rbac_service import create_preset
    await create_user("u1", "Password123", "operator")
    await create_preset("P1", "", ["view"], created_by="admin")

    resp = await client.get("/api/license/status")
    limits = resp.json()["limits"]
    assert limits["users"]["current"] == 1
    assert limits["presets"]["current"] == 1


@pytest.mark.asyncio
async def test_limits_unlimited_in_plus_edition(client, tmp_path, monkeypatch):
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    resp = await client.get("/api/license/status")
    limits = resp.json()["limits"]
    assert limits["users"]["unlimited"] is True
    assert limits["users"]["max"] is None
    assert limits["presets"]["unlimited"] is True
    assert limits["presets"]["max"] is None


# ---------------------------------------------------------------------------
# HMAC tamper-detection tests
# ---------------------------------------------------------------------------

def test_tampered_expiry_fails_mac(tmp_path, monkeypatch):
    """Extending expiry in plus.lic without updating MAC must be rejected."""
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    # Tamper: overwrite expiry with a far-future date
    lic = json.loads(lic_path.read_text())
    lic["expiry"] = "2099-12-31"
    lic_path.write_text(json.dumps(lic))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "tampered"


def test_tampered_edition_fails_mac(tmp_path, monkeypatch):
    """Upgrading edition in plus.lic without updating MAC must be rejected."""
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path, edition="plus_v1")
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    # Tamper: upgrade edition to plus_v2
    lic = json.loads(lic_path.read_text())
    lic["edition"] = "plus_v2"
    lic_path.write_text(json.dumps(lic))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "tampered"


def test_missing_mac_field_fails(tmp_path, monkeypatch):
    """A license without a mac field (old format) must be rejected."""
    from backend.core.config import settings
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(settings, "plus_enc_path", str(enc_path))

    # Remove the mac field
    lic = json.loads(lic_path.read_text())
    lic.pop("mac", None)
    lic_path.write_text(json.dumps(lic))

    status = get_license_status()
    assert status.valid is False
    assert status.reason == "tampered"


# ---------------------------------------------------------------------------
# POST /api/license/upload
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_upload_valid_license(client: AsyncClient, tmp_path, monkeypatch):
    """Uploading a valid .lic file persists it and returns valid=True."""
    lic_path, enc_path = _make_license_files(tmp_path, contact_name="Acme", contact_email="a@acme.de")
    dest = tmp_path / "uploaded.lic"
    monkeypatch.setattr(_settings, "plus_license_path", str(dest))
    monkeypatch.setattr(_settings, "plus_enc_path", str(enc_path))

    lic_bytes = lic_path.read_bytes()
    resp = await client.post(
        "/api/license/upload",
        files={"file": ("plus.lic", lic_bytes, "application/json")},
        headers=_ADMIN_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["contact_name"] == "Acme"
    assert dest.exists()


@pytest.mark.asyncio
async def test_upload_invalid_json(client: AsyncClient, tmp_path, monkeypatch):
    """Uploading non-JSON content returns 422."""
    dest = tmp_path / "uploaded.lic"
    monkeypatch.setattr(_settings, "plus_license_path", str(dest))

    resp = await client.post(
        "/api/license/upload",
        files={"file": ("plus.lic", b"{not json!!!", "application/json")},
        headers=_ADMIN_HEADERS,
    )
    assert resp.status_code == 422
    assert not dest.exists()


@pytest.mark.asyncio
async def test_upload_missing_required_fields(client: AsyncClient, tmp_path, monkeypatch):
    """Uploading JSON without license_id/key returns 422."""
    dest = tmp_path / "uploaded.lic"
    monkeypatch.setattr(_settings, "plus_license_path", str(dest))

    resp = await client.post(
        "/api/license/upload",
        files={"file": ("plus.lic", b'{"foo": "bar"}', "application/json")},
        headers=_ADMIN_HEADERS,
    )
    assert resp.status_code == 422
    assert not dest.exists()


@pytest.mark.asyncio
async def test_upload_overwrites_existing_license(client: AsyncClient, tmp_path, monkeypatch):
    """Uploading a new license overwrites the old file and reloads the cache."""
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    lic_path, enc_path = _make_license_files(src_dir, contact_name="New Holder")
    lic_bytes = lic_path.read_bytes()

    dest = tmp_path / "plus.lic"
    dest.write_text('{"license_id": "old", "key": "old"}')
    monkeypatch.setattr(_settings, "plus_license_path", str(dest))
    monkeypatch.setattr(_settings, "plus_enc_path", str(enc_path))

    resp = await client.post(
        "/api/license/upload",
        files={"file": ("plus.lic", lic_bytes, "application/json")},
        headers=_ADMIN_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["contact_name"] == "New Holder"
    assert dest.read_bytes() == lic_bytes


# ---------------------------------------------------------------------------
# DELETE /api/license/deactivate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_deactivate_renames_lic_file(client: AsyncClient, tmp_path, monkeypatch):
    """Deactivating renames plus.lic to plus.lic.disabled and returns core edition."""
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(_settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(_settings, "plus_enc_path", str(enc_path))

    resp = await client.delete("/api/license/deactivate", headers=_ADMIN_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["edition"] == "core"
    assert data["valid"] is False
    assert data["reason"] == "missing"

    assert not lic_path.exists()
    assert (tmp_path / "plus.lic.disabled").exists()


@pytest.mark.asyncio
async def test_deactivate_no_license_returns_404(client: AsyncClient, tmp_path, monkeypatch):
    """Deactivating when no plus.lic exists returns 404."""
    monkeypatch.setattr(_settings, "plus_license_path", str(tmp_path / "plus.lic"))
    monkeypatch.setattr(_settings, "plus_enc_path", str(tmp_path / "plus.enc"))

    resp = await client.delete("/api/license/deactivate", headers=_ADMIN_HEADERS)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_deactivate_requires_admin(client: AsyncClient, tmp_path, monkeypatch):
    """Deactivating without admin token returns 401."""
    lic_path, enc_path = _make_license_files(tmp_path)
    monkeypatch.setattr(_settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(_settings, "plus_enc_path", str(enc_path))

    resp = await client.delete("/api/license/deactivate")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_deactivate_overwrites_existing_disabled_backup(client: AsyncClient, tmp_path, monkeypatch):
    """If plus.lic.disabled already exists it gets replaced without error."""
    lic_path, enc_path = _make_license_files(tmp_path)
    disabled_path = tmp_path / "plus.lic.disabled"
    disabled_path.write_text("old backup")
    monkeypatch.setattr(_settings, "plus_license_path", str(lic_path))
    monkeypatch.setattr(_settings, "plus_enc_path", str(enc_path))

    resp = await client.delete("/api/license/deactivate", headers=_ADMIN_HEADERS)
    assert resp.status_code == 200
    assert not lic_path.exists()
    assert disabled_path.exists()
    assert disabled_path.read_text() != "old backup"
