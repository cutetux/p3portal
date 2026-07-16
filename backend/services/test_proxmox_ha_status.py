# p3portal.org
"""Tests für ProxmoxClient.get_ha_status_v2 – Ableitung 'active'/'none' aus dem
status/current-ARRAY (Badge-Fix S748: vorher wurde das Array als Dict gelesen →
immer 'none', Cluster-Badge zeigte fälschlich 'HA inaktiv')."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.proxmox import ProxmoxAuth, ProxmoxClient

_AUTH = ProxmoxAuth(kind="token", value="portal@pve!t", secret="uuid")


class _FakeResp:
    def __init__(self, payload, status_code=200):
        self._p = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._p


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kw):
        return self._resp


async def _run(payload, status_code=200):
    pc = ProxmoxClient(base_url="https://x:8006")
    resp = _FakeResp(payload, status_code)
    with patch.object(ProxmoxClient, "_client", new=MagicMock(return_value=_FakeClient(resp))):
        return await pc.get_ha_status_v2(_AUTH)


@pytest.mark.asyncio
async def test_active_when_master_active():
    data = {"data": [
        {"type": "quorum", "quorate": 1, "status": "OK"},
        {"type": "master", "node": "pve1", "status": "active"},
        {"type": "lrm", "node": "pve1", "status": "active"},
    ]}
    assert await _run(data) == "active"


@pytest.mark.asyncio
async def test_active_when_service_present():
    data = {"data": [
        {"type": "quorum", "quorate": 1, "status": "OK"},
        {"type": "service", "sid": "vm:100", "state": "started", "node": "pve1"},
    ]}
    assert await _run(data) == "active"


@pytest.mark.asyncio
async def test_none_without_master_or_service():
    # Quorum + idle LRMs, kein aktiver Master, keine Ressource → HA inaktiv.
    data = {"data": [
        {"type": "quorum", "quorate": 1, "status": "OK"},
        {"type": "lrm", "node": "pve1", "status": "wait_for_agent_lock"},
    ]}
    assert await _run(data) == "none"


@pytest.mark.asyncio
async def test_none_on_empty_array():
    assert await _run({"data": []}) == "none"


@pytest.mark.asyncio
async def test_none_on_404():
    assert await _run({}, status_code=404) == "none"
