# p3portal.org
"""Tests for the PROJ-22 in-memory session credential store."""
from __future__ import annotations

import pytest

from backend.services import session_credential_store as scs


@pytest.fixture(autouse=True)
def clean_store():
    """Clear the credential store before and after each test."""
    scs._store.clear()
    yield
    scs._store.clear()


def test_store_and_retrieve(monkeypatch):
    """Stored credentials can be retrieved and are decrypted correctly."""
    _patch_fernet(monkeypatch)
    scs.store_credentials("jti-1", "admin", "secret123", "pam")
    creds = scs.get_credentials("jti-1")
    assert creds is not None
    assert creds["username"] == "admin"
    assert creds["realm"] == "pam"
    assert creds["password"] == "secret123"


def test_missing_jti_returns_none(monkeypatch):
    """get_credentials returns None for unknown JTI."""
    _patch_fernet(monkeypatch)
    assert scs.get_credentials("nonexistent") is None


def test_clear_removes_credentials(monkeypatch):
    """clear_credentials removes the entry from the store."""
    _patch_fernet(monkeypatch)
    scs.store_credentials("jti-2", "user", "pw", "pve")
    scs.clear_credentials("jti-2")
    assert scs.get_credentials("jti-2") is None


def test_clear_nonexistent_is_noop(monkeypatch):
    """clear_credentials on an unknown JTI does not raise."""
    _patch_fernet(monkeypatch)
    scs.clear_credentials("does-not-exist")  # must not raise


def test_password_encrypted_at_rest(monkeypatch):
    """Stored password_enc differs from the plaintext password."""
    _patch_fernet(monkeypatch)
    scs.store_credentials("jti-3", "u", "mypassword", "pam")
    raw = scs._store["jti-3"]["password_enc"]
    assert raw != b"mypassword"
    assert b"mypassword" not in raw


def test_multiple_sessions_isolated(monkeypatch):
    """Each JTI has its own independent credentials."""
    _patch_fernet(monkeypatch)
    scs.store_credentials("jti-a", "alice", "pw-a", "pam")
    scs.store_credentials("jti-b", "bob", "pw-b", "pve")
    a = scs.get_credentials("jti-a")
    b = scs.get_credentials("jti-b")
    assert a["username"] == "alice"
    assert b["username"] == "bob"
    assert a["password"] == "pw-a"
    assert b["password"] == "pw-b"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _patch_fernet(monkeypatch):
    """Patch config_service._fernet so tests don't need a real SECRET_KEY."""
    import base64
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=b"test_salt", iterations=1)
    key = base64.urlsafe_b64encode(kdf.derive(b"test-secret"))
    fernet = Fernet(key)

    import backend.services.config_service as cfg
    monkeypatch.setattr(cfg, "_fernet_instance", fernet)
