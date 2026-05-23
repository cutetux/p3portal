# p3portal.org
"""PROJ-33: In-memory cluster-data cache with per-node poll intervals.

One cache entry per (portal_node_id, endpoint) pair.  Uses asyncio.Lock per key
to prevent thundering-herd: all concurrent callers for the same key share exactly
one Proxmox fetch.

Only local users (service-account tokens) benefit from the cache; Proxmox-login
users bypass it entirely because they carry personal session cookies.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)


@dataclass
class _CacheEntry:
    data: Any
    fetched_at: float
    is_stale: bool = False
    fetch_duration_ms: float | None = None


class ClusterCacheService:
    """Singleton in-memory cache for Proxmox cluster data.

    Thread-safety note: all operations are coroutine-safe via asyncio.Lock.
    Not process-safe – scoped to a single FastAPI worker process (Single-Container
    deployment, always one process).
    """

    def __init__(self) -> None:
        self._entries: dict[tuple[int, str], _CacheEntry] = {}
        # Per-key locks (created lazily inside an async context to avoid
        # asyncio deprecation warnings when the object is created at import time)
        self._locks: dict[tuple[int, str], asyncio.Lock] = {}
        # Guards lazy lock creation; also created lazily for the same reason
        self._creation_lock: asyncio.Lock | None = None

    async def _get_creation_lock(self) -> asyncio.Lock:
        # Non-await path → atomically safe under the GIL
        if self._creation_lock is None:
            self._creation_lock = asyncio.Lock()
        return self._creation_lock

    async def _get_lock(self, key: tuple[int, str]) -> asyncio.Lock:
        if key in self._locks:
            return self._locks[key]
        cl = await self._get_creation_lock()
        async with cl:
            if key not in self._locks:
                self._locks[key] = asyncio.Lock()
            return self._locks[key]

    def _is_expired(self, entry: _CacheEntry, ttl: int) -> bool:
        return (time.monotonic() - entry.fetched_at) >= ttl

    async def get_or_fetch(
        self,
        node_id: int,
        endpoint: str,
        ttl: int,
        fetch_fn: Callable[[], Awaitable[Any]],
        force: bool = False,
        on_fresh_data: Optional[Callable[[int, str, Any], Awaitable[None]]] = None,
    ) -> Any:
        """Return cached data for (node_id, endpoint) or fetch fresh data.

        force=True      – invalidate ALL entries first (Dashboard Refresh-Button).
        TTL             – seconds; taken from NodeRow.poll_interval.
        on_fresh_data   – optional PROJ-34 callback; called as
                          asyncio.create_task(on_fresh_data(node_id, endpoint, data))
                          when fresh data is stored. Fire-and-forget; does not block cache.
        On fetch error with stale cache: return stale data and mark entry stale.
        On fetch error without any cache: re-raise so the caller can return 502.
        """
        key = (node_id, endpoint)

        if force:
            self.invalidate_all()

        # Fast path: valid entry exists
        entry = self._entries.get(key)
        if entry is not None and not self._is_expired(entry, ttl):
            return entry.data

        # Slow path: acquire per-key lock to prevent thundering herd
        lock = await self._get_lock(key)
        async with lock:
            # Re-check – another coroutine may have fetched while we waited
            entry = self._entries.get(key)
            if entry is not None and not self._is_expired(entry, ttl):
                return entry.data

            try:
                t0 = time.monotonic()
                data = await fetch_fn()
                duration_ms = (time.monotonic() - t0) * 1000
                self._entries[key] = _CacheEntry(
                    data=data,
                    fetched_at=time.monotonic(),
                    fetch_duration_ms=round(duration_ms, 1),
                )
                # PROJ-34: fire alert-check callback without blocking cache response
                if on_fresh_data is not None:
                    asyncio.create_task(on_fresh_data(node_id, endpoint, data))
                return data
            except Exception:
                if entry is not None:
                    logger.warning(
                        "PROJ-33: Proxmox fetch failed for (%d, %s); returning stale data",
                        node_id,
                        endpoint,
                    )
                    entry.is_stale = True
                    return entry.data
                raise

    def invalidate_all(self) -> None:
        """Remove all cache entries (Dashboard force-refresh)."""
        self._entries.clear()

    def invalidate_node(self, node_id: int) -> None:
        """Remove all cache entries for a specific portal node (called on node deletion)."""
        keys = [k for k in self._entries if k[0] == node_id]
        for k in keys:
            del self._entries[k]

    def entry_count(self) -> int:
        return len(self._entries)

    def is_stale(self, node_id: int, endpoint: str) -> bool:
        entry = self._entries.get((node_id, endpoint))
        return entry.is_stale if entry is not None else False

    def get_duration_ms(self, node_id: int, endpoint: str) -> float | None:
        entry = self._entries.get((node_id, endpoint))
        return entry.fetch_duration_ms if entry is not None else None

    def get_all_stats(self) -> list[dict]:
        """Return cache stats for all entries (used by admin cache-stats endpoint)."""
        now = time.monotonic()
        result = []
        for (node_id, endpoint), entry in self._entries.items():
            result.append({
                "node_id": node_id,
                "endpoint": endpoint,
                "fetch_duration_ms": entry.fetch_duration_ms,
                "age_seconds": round(now - entry.fetched_at, 1),
                "is_stale": entry.is_stale,
            })
        return result


cluster_cache = ClusterCacheService()
