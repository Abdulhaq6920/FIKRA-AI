"""Redis connectivity helpers.

Redis is used as the Celery broker/result backend and application cache.
There is no long-lived shared client: connections are opened only for health
checks and closed immediately, keeping the pool footprint minimal.
"""

from __future__ import annotations

from redis.asyncio import Redis

from app.core.config import settings


def _client() -> Redis:
    """Create a short-lived async Redis client with fail-fast timeouts."""
    return Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
    )


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
        return {queue: int(await client.llen(queue)) for queue in queues}
    finally:
        await client.aclose()
