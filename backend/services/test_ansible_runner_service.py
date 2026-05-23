# p3portal.org
"""Unit tests for ansible_runner_service._build_extravars (PROJ-22)."""
from __future__ import annotations

import pytest


def _make_settings(
    proxmox_host: str = "https://pve.example.com:8006",
    operator_token_id: str = "operator@pam!op-token",
    operator_token_secret: str = "op-secret",
    admin_token_id: str = "admin@pam!admin-token",
    admin_token_secret: str = "admin-secret",
):
    """Patch settings with deterministic values for extravars tests."""
    from backend.core.config import settings

    settings.proxmox_host = proxmox_host
    settings.proxmox_operator_token_id = operator_token_id
    settings.proxmox_operator_token_secret = operator_token_secret
    settings.proxmox_admin_token_id = admin_token_id
    settings.proxmox_admin_token_secret = admin_token_secret


# ── User-context mode (Proxmox-login user) ────────────────────────────────────

def test_user_context_injects_api_user_and_password(monkeypatch):
    """AC-2: Proxmox-login user gets api_user + api_password, not token vars."""
    _make_settings()
    from backend.services.ansible_runner_service import _build_extravars

    creds = {"username": "john", "realm": "pam", "password": "hunter2"}
    result = _build_extravars({}, "operator", proxmox_credentials=creds)

    assert result["api_user"] == "john@pam"
    assert result["api_password"] == "hunter2"
    assert "proxmox_portal_token_name" not in result
    assert "proxmox_portal_token_secret" not in result


def test_user_context_api_user_realm_formatting(monkeypatch):
    """api_user is formatted as username@realm."""
    _make_settings()
    from backend.services.ansible_runner_service import _build_extravars

    creds = {"username": "maria", "realm": "pve", "password": "pw"}
    result = _build_extravars({}, "admin", proxmox_credentials=creds)
    assert result["api_user"] == "maria@pve"


def test_user_context_passes_through_user_params(monkeypatch):
    """User-supplied params are preserved in user-context mode."""
    _make_settings()
    from backend.services.ansible_runner_service import _build_extravars

    creds = {"username": "u", "realm": "pam", "password": "p"}
    result = _build_extravars({"vm_name": "myvm", "vm_cores": 2}, "operator", proxmox_credentials=creds)
    assert result["vm_name"] == "myvm"
    assert result["vm_cores"] == 2


# ── Service-account mode (Portal-login user) ──────────────────────────────────

def test_service_account_operator_uses_operator_token(monkeypatch):
    """AC-4: Portal-login operator gets operator token injected via token_id_override."""
    from backend.services.ansible_runner_service import _build_extravars

    result = _build_extravars(
        {}, "operator", proxmox_credentials=None,
        token_id_override="operator@pam!op-token",
        token_secret_override="op-secret",
    )

    assert "api_password" not in result
    assert "api_user" not in result
    assert result["proxmox_portal_token_name"] == "op-token"
    assert result["proxmox_portal_token_secret"] == "op-secret"


def test_service_account_admin_uses_admin_token(monkeypatch):
    """AC-4: Portal-login admin gets admin token injected via token_id_override."""
    from backend.services.ansible_runner_service import _build_extravars

    result = _build_extravars(
        {}, "admin", proxmox_credentials=None,
        token_id_override="admin@pam!admin-token",
        token_secret_override="admin-secret",
    )

    assert result["proxmox_portal_token_name"] == "admin-token"
    assert result["proxmox_portal_token_secret"] == "admin-secret"
    assert "api_password" not in result


def test_service_account_includes_proxmox_api_host(monkeypatch):
    """proxmox_api_host is always injected, regardless of auth mode."""
    _make_settings(proxmox_host="https://cluster.example.com:8006")
    from backend.services.ansible_runner_service import _build_extravars

    result = _build_extravars({}, "operator", proxmox_credentials=None)
    assert result["proxmox_api_host"] == "cluster.example.com"


def test_user_context_includes_proxmox_api_host(monkeypatch):
    """proxmox_api_host is injected in user-context mode too."""
    _make_settings(proxmox_host="https://mypve.local:8006")
    from backend.services.ansible_runner_service import _build_extravars

    creds = {"username": "u", "realm": "pam", "password": "p"}
    result = _build_extravars({}, "operator", proxmox_credentials=creds)
    assert result["proxmox_api_host"] == "mypve.local"
