# p3portal.org
"""Tests für ProxmoxClient.get_nodes_with_swap – Swap-Anreicherung der Node-Liste."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.proxmox import ProxmoxAuth, ProxmoxClient


class _FakeResp:
    def __init__(self, payload):
        self._p = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._p


class _FakeClient:
    """Async-Context-Manager, der /nodes/{node}/status-Swap aus einer Map liefert."""
    def __init__(self, swap_by_node):
        self._swap = swap_by_node

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kw):
        node = url.rstrip("/").split("/nodes/")[1].split("/")[0]
        return _FakeResp({"data": {"swap": self._swap.get(node, {})}})


_AUTH = ProxmoxAuth(kind="token", value="portal@pve!t", secret="uuid")


@pytest.mark.asyncio
async def test_merges_swap_for_online_nodes():
    pc = ProxmoxClient(base_url="https://x:8006")
    nodes = [
        {"node": "pve1", "status": "online"},
        {"node": "pve2", "status": "online"},
        {"node": "pve3", "status": "offline"},
    ]
    swap_map = {"pve1": {"used": 100, "total": 1000}, "pve2": {}}
    with (
        patch.object(ProxmoxClient, "get_cluster_resources_v2", new=AsyncMock(return_value=nodes)),
        patch.object(ProxmoxClient, "_client", new=MagicMock(return_value=_FakeClient(swap_map))),
    ):
        result = await pc.get_nodes_with_swap(_AUTH)

    by = {n["node"]: n for n in result}
    assert by["pve1"]["swap"] == 100
    assert by["pve1"]["maxswap"] == 1000
    # online aber kein Swap konfiguriert → total 0 (Frontend blendet Balken aus)
    assert by["pve2"]["maxswap"] == 0
    # offline → unberührt, kein Swap-Key
    assert "swap" not in by["pve3"]


@pytest.mark.asyncio
async def test_status_error_is_swallowed():
    pc = ProxmoxClient(base_url="https://x:8006")
    nodes = [{"node": "pve1", "status": "online"}]

    class _BoomClient(_FakeClient):
        async def get(self, url, **kw):
            raise RuntimeError("boom")

    with (
        patch.object(ProxmoxClient, "get_cluster_resources_v2", new=AsyncMock(return_value=nodes)),
        patch.object(ProxmoxClient, "_client", new=MagicMock(return_value=_BoomClient({}))),
    ):
        result = await pc.get_nodes_with_swap(_AUTH)

    # Fehler beim Status-Call darf die Liste nicht sprengen
    assert result[0]["node"] == "pve1"
    assert result[0].get("maxswap", 0) == 0
