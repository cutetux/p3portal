# p3portal.org
"""PROJ-33: Unit tests for ClusterCacheService."""
from __future__ import annotations

import asyncio
import time

import pytest

from backend.services.cluster_cache_service import ClusterCacheService


@pytest.fixture
def cache() -> ClusterCacheService:
    return ClusterCacheService()


# ── basic get_or_fetch ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_miss_calls_fetch_fn(cache: ClusterCacheService):
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return [{"node": "pve1"}]

    result = await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    assert result == [{"node": "pve1"}]
    assert calls == 1


@pytest.mark.asyncio
async def test_cache_hit_does_not_call_fetch_fn(cache: ClusterCacheService):
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return [{"node": "pve1"}]

    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)

    assert calls == 1  # second call was a cache hit


@pytest.mark.asyncio
async def test_different_endpoints_cached_separately(cache: ClusterCacheService):
    nodes_calls = 0
    vms_calls = 0

    async def fetch_nodes():
        nonlocal nodes_calls
        nodes_calls += 1
        return [{"type": "node"}]

    async def fetch_vms():
        nonlocal vms_calls
        vms_calls += 1
        return [{"type": "vm"}]

    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch_nodes)
    await cache.get_or_fetch(1, "vms", ttl=30, fetch_fn=fetch_vms)
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch_nodes)
    await cache.get_or_fetch(1, "vms", ttl=30, fetch_fn=fetch_vms)

    assert nodes_calls == 1
    assert vms_calls == 1


@pytest.mark.asyncio
async def test_different_nodes_cached_separately(cache: ClusterCacheService):
    calls: dict[int, int] = {1: 0, 2: 0}

    async def make_fetch(node_id: int):
        async def fetch():
            calls[node_id] += 1
            return [{"node_id": node_id}]
        return fetch

    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=await make_fetch(1))
    await cache.get_or_fetch(2, "nodes", ttl=30, fetch_fn=await make_fetch(2))
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=await make_fetch(1))
    await cache.get_or_fetch(2, "nodes", ttl=30, fetch_fn=await make_fetch(2))

    assert calls[1] == 1
    assert calls[2] == 1


@pytest.mark.asyncio
async def test_expired_entry_triggers_refetch(cache: ClusterCacheService):
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return [{"v": calls}]

    # First fetch
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    assert calls == 1

    # Manually expire the entry
    cache._entries[(1, "nodes")].fetched_at = time.monotonic() - 31

    # Should re-fetch
    result = await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    assert calls == 2
    assert result == [{"v": 2}]


# ── force=True ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_force_invalidates_all_entries(cache: ClusterCacheService):
    node1_calls = 0
    node2_calls = 0

    async def fetch_node1():
        nonlocal node1_calls
        node1_calls += 1
        return [{"n": 1}]

    async def fetch_node2():
        nonlocal node2_calls
        node2_calls += 1
        return [{"n": 2}]

    # Warm up cache for both nodes
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch_node1)
    await cache.get_or_fetch(2, "nodes", ttl=30, fetch_fn=fetch_node2)
    assert node1_calls == 1
    assert node2_calls == 1

    # Force-refresh on node 1 → clears ALL entries
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch_node1, force=True)
    assert node1_calls == 2  # re-fetched

    # Node 2 cache was also cleared → must re-fetch
    await cache.get_or_fetch(2, "nodes", ttl=30, fetch_fn=fetch_node2)
    assert node2_calls == 2  # re-fetched because invalidate_all cleared it


# ── invalidate_all / invalidate_node ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_invalidate_all_clears_all(cache: ClusterCacheService):
    async def fetch():
        return [1, 2, 3]

    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    await cache.get_or_fetch(2, "vms", ttl=30, fetch_fn=fetch)
    assert cache.entry_count() == 2

    cache.invalidate_all()
    assert cache.entry_count() == 0


@pytest.mark.asyncio
async def test_invalidate_node_clears_only_that_node(cache: ClusterCacheService):
    async def fetch():
        return []

    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    await cache.get_or_fetch(1, "vms", ttl=30, fetch_fn=fetch)
    await cache.get_or_fetch(2, "nodes", ttl=30, fetch_fn=fetch)
    assert cache.entry_count() == 3

    cache.invalidate_node(1)
    assert cache.entry_count() == 1
    assert (2, "nodes") in cache._entries
    assert (1, "nodes") not in cache._entries
    assert (1, "vms") not in cache._entries


# ── stale-data fallback on error ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_data_returned_on_fetch_error(cache: ClusterCacheService):
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        if calls == 1:
            return [{"node": "pve1"}]
        raise RuntimeError("Proxmox unreachable")

    # Warm up
    await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    # Expire entry
    cache._entries[(1, "nodes")].fetched_at = time.monotonic() - 31

    # Should return stale data and mark is_stale=True
    result = await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)
    assert result == [{"node": "pve1"}]
    assert cache.is_stale(1, "nodes") is True


@pytest.mark.asyncio
async def test_no_stale_data_propagates_error(cache: ClusterCacheService):
    async def fetch():
        raise RuntimeError("Proxmox unreachable")

    with pytest.raises(RuntimeError, match="Proxmox unreachable"):
        await cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=fetch)


# ── thundering-herd protection ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_concurrent_requests_trigger_single_fetch(cache: ClusterCacheService):
    calls = 0
    event = asyncio.Event()

    async def slow_fetch():
        nonlocal calls
        calls += 1
        # Simulate a slow Proxmox call
        await asyncio.sleep(0.01)
        return [{"result": calls}]

    # Launch 5 concurrent requests for the same key
    results = await asyncio.gather(
        *[cache.get_or_fetch(1, "nodes", ttl=30, fetch_fn=slow_fetch) for _ in range(5)]
    )

    # All 5 get the same result, only 1 fetch occurred
    assert calls == 1
    assert all(r == [{"result": 1}] for r in results)
