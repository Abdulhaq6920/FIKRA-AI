"""
In-process sliding-window rate limiting.

Enforces the rate limits configured in Settings (rate_limit_login,
rate_limit_chat, rate_limit_upload) on abuse-prone endpoints.

Design notes:
- State lives in process memory (no external dependency). This is exact
  for a single-process deployment; with multiple Uvicorn workers each
  worker holds its own window, so effective limits scale with worker
  count. Swap in a Redis-backed counter if strict global limits across
  workers are required (Redis is already part of the stack).
- The limiter runs as the outermost HTTP middleware and answers 429 with
  the same JSON error envelope the AppError handler produces, plus a
  Retry-After header. It must not raise into FastAPI's exception
  handlers because middleware sits outside them.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from app.core.logging import get_logger

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


# Shared limiter instance for the middleware.
limiter = SlidingWindowLimiter()
