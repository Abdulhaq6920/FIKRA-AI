"""
Sliding-window rate limiting with a Redis-backed global window.

Enforces the rate limits configured in Settings (rate_limit_login,
rate_limit_chat, rate_limit_upload) on abuse-prone endpoints.

Design notes:
- In production the window is a Redis sorted set, so all API workers and
  replicas share one counter. In development/tests (or when Redis is down)
  the original in-process limiter is used as a fail-open fallback.
- The limiter runs as the outermost HTTP middleware and answers 429 with
  the same JSON error envelope the AppError handler produces, plus a
  Retry-After header. It must not raise into FastAPI's exception
  handlers because middleware sits outside them.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import cast

from app.core.config import settings
from app.core.logging import get_logger
from app.core.redis import get_shared_redis

logger = get_logger(__name__)

_PERIODS: dict[str, int] = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
}


@dataclass(frozen=True)
class RateSpec:
    """A parsed '<count>/<period>' limit, e.g. '10/minute' -> (10, 60)."""

    max_events: int
    period_seconds: float


def parse_rate(spec: str) -> RateSpec:
    """Parse a rate limit string like '10/minute' or '5/hour'."""
    try:
        value, _, unit = spec.strip().partition("/")
        max_events = int(value)
        period = _PERIODS[unit.strip().lower().rstrip("s")]
        if max_events < 1:
            raise ValueError
        return RateSpec(max_events=max_events, period_seconds=float(period))
    except (ValueError, KeyError) as exc:
        raise ValueError(f"Invalid rate limit spec: {spec!r}") from exc


class SlidingWindowLimiter:
    """
    Thread-safe sliding-window counter keyed by arbitrary strings.

    Keys should combine the scope name and the client identity, e.g.
    ``"login:1.2.3.4"``. Memory is bounded by a periodic sweep that drops
    keys with no recent activity.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()
        # How often stale keys are dropped from memory.
        self._sweep_interval = 600.0

    def check(self, key: str, spec: RateSpec) -> tuple[bool, int]:
        """
        Record an attempt for *key* and return (allowed, retry_after_seconds).

        retry_after is 0 when the request is allowed.
        """
        now = time.monotonic()
        cutoff = now - spec.period_seconds
        with self._lock:
            self._sweep(now)
            window = self._hits[key]
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= spec.max_events:
                retry_after = int(max(window[0] + spec.period_seconds - now, 0)) + 1
                return False, retry_after
            window.append(now)
            return True, 0

    def _sweep(self, now: float) -> None:
        """Periodic maintenance: drop empty/stale windows (must hold _lock)."""
        if now - self._last_sweep < self._sweep_interval:
            return
        # Conservative retention: drop windows with no activity in the last
        # hour (covers every limit period in use).
        cutoff = now - 3600.0
        for key in list(self._hits):
            window = self._hits[key]
            while window and window[0] <= cutoff:
                window.popleft()
            if not window:
                del self._hits[key]
        self._last_sweep = now


# Shared fallback limiter instance for the middleware.
limiter = SlidingWindowLimiter()

# Atomic Redis sliding window. KEYS[1] is the bucket, ARGV is
# (now, window_seconds, max_events, unique member). A rejected request is not
# recorded, otherwise a burst would keep its own window full.
#
# Long script formatting is intentional: it is passed verbatim to EVAL.
_SLIDING_WINDOW_SCRIPT = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    local retry = 1
    if oldest[2] then
        retry = math.max(1, math.ceil(tonumber(oldest[2]) + window - now))
    end
    redis.call('EXPIRE', KEYS[1], math.ceil(window) + 1)
    return '1:' .. retry
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('EXPIRE', KEYS[1], math.ceil(window) + 1)
return '0:0'
"""

# Bind the ARGV names used above into the Lua environment on every call.
_LUA_PROLOGUE = """
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
"""


async def check_rate_limit(key: str, spec: RateSpec) -> tuple[bool, int]:
    """
    Return (allowed, retry_after_seconds) for one request.

    Uses Redis when enabled, and falls back to the in-process limiter if Redis
    is unavailable — rejecting legitimate traffic because a cache is down
    would be a worse failure mode than a temporarily wider limit.
    """
    if not settings.use_distributed_rate_limit:
        return limiter.check(key, spec)

    try:
        raw = await cast(
            "Awaitable[str]",
            get_shared_redis().eval(
                _LUA_PROLOGUE + _SLIDING_WINDOW_SCRIPT,
                1,
                f"ratelimit:{key}",
                str(time.time()),
                str(spec.period_seconds),
                str(spec.max_events),
                uuid.uuid4().hex,
            ),
        )
        denied, _, retry_after = raw.partition(":")
        return denied != "1", int(retry_after)
    except Exception as exc:  # fail open, but log loudly
        logger.warning("rate_limit_redis_unavailable", key=key, error=str(exc))
        return limiter.check(key, spec)

