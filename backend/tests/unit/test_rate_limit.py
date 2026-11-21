"""Unit tests for rate-limit parsing, the local fallback and the Redis window."""

from __future__ import annotations

from collections.abc import Sequence

import pytest

import app.core.rate_limit as rate_limit_module
from app.core.config import settings
from app.core.rate_limit import RateSpec, SlidingWindowLimiter, check_rate_limit, parse_rate


@pytest.mark.parametrize(
    ("spec", "expected"),
    [
        ("10/minute", RateSpec(max_events=10, period_seconds=60.0)),
        ("5/hour", RateSpec(max_events=5, period_seconds=3600.0)),
        ("2/seconds", RateSpec(max_events=2, period_seconds=1.0)),
    ],
)
def test_parse_rate(spec: str, expected: RateSpec) -> None:
    assert parse_rate(spec) == expected


@pytest.mark.parametrize("spec", ["not-a-limit", "0/minute", "10/fortnight"])
def test_parse_rate_rejects_invalid_specs(spec: str) -> None:
    with pytest.raises(ValueError):
        parse_rate(spec)


def test_in_process_limiter_enforces_window() -> None:
    limiter = SlidingWindowLimiter()
    spec = RateSpec(max_events=2, period_seconds=60.0)

    assert limiter.check("unit:local", spec) == (True, 0)
    assert limiter.check("unit:local", spec) == (True, 0)
    allowed, retry_after = limiter.check("unit:local", spec)

    assert allowed is False
    assert retry_after > 0


class _FakeRedis:
    """Minimal stand-in for the async Redis client used by check_rate_limit."""

    def __init__(self, results: Sequence[str] | None = None) -> None:
        self.results = list(results or ["0:0"])
        self.keys: list[str] = []

    async def eval(self, script: str, numkeys: int, key: str, *args: object) -> str:
        assert numkeys == 1
        assert "ZREMRANGEBYSCORE" in script
        self.keys.append(key)
        return self.results[min(len(self.keys) - 1, len(self.results) - 1)]


@pytest.mark.asyncio
async def test_redis_window_is_global_and_returns_retry_after(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rate_limit_distributed", True)
    fake = _FakeRedis(["0:0", "1:7"])
    monkeypatch.setattr(rate_limit_module, "get_shared_redis", lambda: fake)
    spec = RateSpec(max_events=2, period_seconds=60.0)

    assert await check_rate_limit("login:1.2.3.4", spec) == (True, 0)
    assert await check_rate_limit("login:1.2.3.4", spec) == (False, 7)
    assert fake.keys == ["ratelimit:login:1.2.3.4", "ratelimit:login:1.2.3.4"]


class _BrokenRedis:
    async def eval(self, *args: object) -> str:
        raise RuntimeError("redis is down")


@pytest.mark.asyncio
async def test_redis_failure_falls_back_to_local_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rate_limit_distributed", True)
    monkeypatch.setattr(rate_limit_module, "get_shared_redis", lambda: _BrokenRedis())

    allowed, retry_after = await check_rate_limit(
        "unit:fallback", RateSpec(max_events=1, period_seconds=60.0)
    )

    assert allowed is True
    assert retry_after == 0


@pytest.mark.asyncio
async def test_development_uses_local_window_without_touching_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rate_limit_distributed", False)

    def _unexpected_client() -> None:
        raise AssertionError("Redis must not be used when distributed limiting is disabled")

    monkeypatch.setattr(rate_limit_module, "get_shared_redis", _unexpected_client)

    allowed, retry_after = await check_rate_limit(
        "unit:local-mode", RateSpec(max_events=1, period_seconds=60.0)
    )

    assert (allowed, retry_after) == (True, 0)
