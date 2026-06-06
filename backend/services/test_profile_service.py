# p3portal.org
"""Tests für profile_service – SSH-Job-Key Public-Key-Ableitung."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, NoEncryption, PrivateFormat, PublicFormat,
)

from backend.services.profile_service import get_ssh_job_public_key


def _make_keypair() -> tuple[str, str]:
    key = Ed25519PrivateKey.generate()
    private_pem = key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()).decode()
    public_openssh = key.public_key().public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).decode()
    return private_pem, public_openssh.strip()


@pytest.mark.asyncio
async def test_public_key_derived_from_stored_private_key():
    private_pem, expected_pub = _make_keypair()
    with patch(
        "backend.services.profile_service.get_ssh_job_key_decrypted",
        new=AsyncMock(return_value=private_pem),
    ):
        result = await get_ssh_job_public_key("alice")
    assert result == f"{expected_pub} p3portal-job-key"


@pytest.mark.asyncio
async def test_returns_none_when_no_key():
    with patch(
        "backend.services.profile_service.get_ssh_job_key_decrypted",
        new=AsyncMock(return_value=None),
    ):
        assert await get_ssh_job_public_key("alice") is None


@pytest.mark.asyncio
async def test_returns_none_on_unparseable_private_key():
    with patch(
        "backend.services.profile_service.get_ssh_job_key_decrypted",
        new=AsyncMock(return_value="not-a-real-key"),
    ):
        assert await get_ssh_job_public_key("alice") is None
