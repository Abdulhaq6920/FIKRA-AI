"""Redis connectivity helpers.

Redis is used as the Celery broker/result backend and application cache.
There is no long-lived shared client: connections are opened only for health
checks and closed immediately, keeping the pool footprint minimal.
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import cast

from redis.asyncio import Redis

from app.core.config import settings


def _client() -> Redis:
    """Create a short-lived async Redis client with fail-fast timeouts."""
    # redis-py's from_url is untyped (returns Any); the annotation is what makes
    # the call sites below type-check against the real client surface.
    client: Redis = Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    return client


_shared_client: Redis | None = None


def get_shared_redis() -> Redis:
    """Return the long-lived client used by cross-process primitives.

    Rate limiting needs one client per worker process, not one connection per
    request. Created lazily so importing this module never requires Redis.
    """
    global _shared_client
    if _shared_client is None:
        client: Redis = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
        _shared_client = client
    return _shared_client


async def close_shared_redis() -> None:
    """Close the shared client during application shutdown."""
    global _shared_client
    if _shared_client is not None:
        await _shared_client.aclose()
        _shared_client = None


async def ping_redis() -> None:
    """Raise if Redis is unreachable; return normally on a successful PING."""
    client = _client()
    try:
        await client.ping()
    finally:
        await client.aclose()


async def queue_depths(queues: tuple[str, ...]) -> dict[str, int]:
    """Return the pending-message count for each Celery queue.

    A missing key means an empty queue, which Redis reports as 0. Errors are
    the caller's to handle; this helper never swallows them.
    """
    client = _client()
    try:
        counts: dict[str, int] = {}
        for queue in queues:
            # redis-py types commands as `Awaitable[T] | T`; in async mode it is
            # always the awaitable.
            counts[queue] = int(await cast("Awaitable[int]", client.llen(queue)))
        return counts
    finally:
        await client.aclose()
