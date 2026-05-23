# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-50: Tests für secret_masking.py."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.plus_only

from backend.plus.approvals import secret_masking


@pytest.fixture(autouse=True)
def reset_fernet(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-approvals-12345")
    secret_masking.reset_fernet_cache()
    yield
    secret_masking.reset_fernet_cache()


# ── split_payload ──────────────────────────────────────────────────────────────

def test_split_payload_no_secrets():
    payload = {"vm_name": "test-vm", "cpu": 2}
    public, secrets = secret_masking.split_payload(payload, [])
    assert public == payload
    assert secrets == {}


def test_split_payload_by_key_name():
    payload = {"vm_name": "test", "password": "hunter2", "token": "abc123"}
    public, secrets = secret_masking.split_payload(payload, [])
    assert public["vm_name"] == "test"
    assert public["password"] == "__secret__"
    assert public["token"] == "__secret__"
    assert secrets["password"] == "hunter2"
    assert secrets["token"] == "abc123"


def test_split_payload_by_meta_type():
    meta_fields = [
        {"id": "api_key", "type": "secret", "sensitive": False},
        {"id": "cpu_count", "type": "integer"},
    ]
    payload = {"api_key": "sk-1234", "cpu_count": 4}
    public, secrets = secret_masking.split_payload(payload, meta_fields)
    assert public["api_key"] == "__secret__"
    assert public["cpu_count"] == 4
    assert secrets["api_key"] == "sk-1234"


def test_split_payload_by_sensitive_flag():
    meta_fields = [{"id": "custom_field", "type": "string", "sensitive": True}]
    payload = {"custom_field": "very-secret"}
    public, secrets = secret_masking.split_payload(payload, meta_fields)
    assert public["custom_field"] == "__secret__"
    assert secrets["custom_field"] == "very-secret"


# ── encrypt / decrypt ──────────────────────────────────────────────────────────

def test_encrypt_decrypt_roundtrip():
    secrets = {"password": "hunter2", "ssh_key": "-----BEGIN..."}
    blob = secret_masking.encrypt_secrets(secrets)
    assert blob is not None
    assert blob != str(secrets)

    recovered = secret_masking.decrypt_secrets(blob)
    assert recovered == secrets


def test_encrypt_empty_returns_none():
    assert secret_masking.encrypt_secrets({}) is None


def test_decrypt_none_returns_empty():
    assert secret_masking.decrypt_secrets(None) == {}


# ── merge_payload ──────────────────────────────────────────────────────────────

def test_merge_payload_replaces_markers():
    public = {"vm_name": "test", "password": "__secret__", "cpu": 2}
    secrets = {"password": "hunter2"}
    merged = secret_masking.merge_payload(public, secrets)
    assert merged["password"] == "hunter2"
    assert merged["vm_name"] == "test"
    assert merged["cpu"] == 2


def test_merge_payload_no_secrets():
    public = {"vm_name": "test"}
    merged = secret_masking.merge_payload(public, {})
    assert merged == public


# ── payload_hash ──────────────────────────────────────────────────────────────

def test_payload_hash_deterministic():
    payload = {"b": 2, "a": 1}
    h1 = secret_masking.payload_hash(payload)
    h2 = secret_masking.payload_hash(payload)
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex


def test_payload_hash_different_values():
    h1 = secret_masking.payload_hash({"key": "val1"})
    h2 = secret_masking.payload_hash({"key": "val2"})
    assert h1 != h2
