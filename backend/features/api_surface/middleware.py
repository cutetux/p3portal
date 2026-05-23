# p3portal.org
"""PROJ-44: UpkRateLimitMiddleware – Token-Bucket pro upk_-Key (AC-14..AC-16).

Greift nur auf Requests mit 'Authorization: Bearer upk_...' (AC-15).
Limit konfigurierbar via Env-Var UPK_RATE_LIMIT_PER_MIN (Default 600).

Bei Multi-Worker-Deployments gilt das Limit pro Worker-Prozess (Tech-Design E,
im CHANGELOG dokumentiert).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

_RATE_LIMIT_PER_MIN: int = int(os.environ.get("UPK_RATE_LIMIT_PER_MIN", "600"))


@dataclass
class _BucketState:
    tokens: float
    last_refill: float
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class UpkRateLimitMiddleware(BaseHTTPMiddleware):
    """Token-Bucket Rate-Limiter für upk_-Bearer-Tokens."""

    def __init__(self, app, rate_per_min: int | None = None):
        super().__init__(app)
        self._capacity = rate_per_min or _RATE_LIMIT_PER_MIN
        self._refill_rate = self._capacity / 60.0  # Tokens pro Sekunde
        self._buckets: dict[str, _BucketState] = {}

    def _get_bucket(self, key_prefix: str) -> _BucketState:
        if key_prefix not in self._buckets:
            self._buckets[key_prefix] = _BucketState(
                tokens=float(self._capacity),
                last_refill=time.monotonic(),
            )
        return self._buckets[key_prefix]

    async def _consume(self, key_prefix: str) -> tuple[bool, int]:
        """Versucht ein Token zu verbrauchen. Gibt (ok, retry_after_seconds) zurück."""
        bucket = self._get_bucket(key_prefix)
        async with bucket.lock:
            now = time.monotonic()
            elapsed = now - bucket.last_refill
            bucket.tokens = min(
                self._capacity,
                bucket.tokens + elapsed * self._refill_rate,
            )
            bucket.last_refill = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return True, 0
            else:
                # Sekunden bis zum nächsten Token
                retry_after = int((1.0 - bucket.tokens) / self._refill_rate) + 1
                return False, retry_after

    async def dispatch(self, request: Request, call_next) -> Response:
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer upk_"):
            return await call_next(request)

        # Key-Prefix aus dem Token extrahieren (erste 12 Zeichen nach 'upk_')
        token = auth[len("Bearer "):]
        key_prefix = token[:16]  # 'upk_' + 12 chars als Bucket-Key

        ok, retry_after = await self._consume(key_prefix)
        if not ok:
            return Response(
                content='{"detail":"Rate limit exceeded","retry_after":' + str(retry_after) + '}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)
