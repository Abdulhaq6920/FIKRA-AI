"""Prometheus metric definitions and helpers.

One registry, one module: every metric the service exposes is declared here so
dashboards and alerts have a single, reviewable source of truth.

Cardinality rules (deliberate, do not relax):
- HTTP metrics label by *route template* (``/api/v1/documents/{document_id}``),
  never the raw path.
- ``organization_id``/``user_id`` never appear on request metrics; they belong in
  logs and traces, and only on the low-volume LLM cost counter.
- Status codes are bucketed into classes (``2xx``, ``4xx`` …) to stay bounded.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from sqlalchemy.pool import QueuePool

REGISTRY = CollectorRegistry(auto_describe=False)

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "HTTP requests by method, route template and status class.",
    ["method", "route", "status_class"],
    registry=REGISTRY,
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds.",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60),
    registry=REGISTRY,
)

HTTP_RESPONSE_SIZE_BYTES = Histogram(
    "http_response_size_bytes",
    "HTTP response body size in bytes.",
    ["route"],
    buckets=(512, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304),
    registry=REGISTRY,
)

# ---------------------------------------------------------------------------
# RAG pipeline — the metric that explains a 12 s answer
# ---------------------------------------------------------------------------
RAG_STAGE_DURATION_SECONDS = Histogram(
    "rag_stage_duration_seconds",
    "Time spent per RAG stage.",
    ["stage"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32),
    registry=REGISTRY,
)

RAG_REQUESTS_TOTAL = Counter(
    "rag_requests_total",
    "RAG requests by terminal outcome.",
    ["outcome"],
    registry=REGISTRY,
)

RETRIEVAL_CANDIDATES = Histogram(
    "retrieval_candidates",
    "Candidate passages surviving each retrieval stage.",
    ["stage"],
    buckets=(0, 1, 2, 4, 6, 8, 12, 20, 50),
    registry=REGISTRY,
)

RETRIEVAL_TOP_SCORE = Histogram(
    "retrieval_top_score",
    "Highest relevance score returned to the prompt builder.",
    buckets=(0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1),
    registry=REGISTRY,
)

# ---------------------------------------------------------------------------
# LLM usage and cost
# ---------------------------------------------------------------------------
LLM_TOKENS_TOTAL = Counter(
    "llm_tokens_total",
    "Tokens consumed by the LLM, split by direction.",
    ["model", "direction"],
    registry=REGISTRY,
)

LLM_COST_USD_TOTAL = Counter(
    "llm_cost_usd_total",
    "Estimated LLM spend in USD.",
    ["model"],
    registry=REGISTRY,
)

LLM_TIME_TO_FIRST_TOKEN_SECONDS = Histogram(
    "llm_time_to_first_token_seconds",
    "Time from request to first streamed token.",
    ["model"],
    buckets=(0.1, 0.25, 0.5, 1, 2, 4, 8),
    registry=REGISTRY,
)

# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------
INGESTION_DURATION_SECONDS = Histogram(
    "ingestion_duration_seconds",
    "End-to-end document ingestion duration.",
    ["extension", "outcome"],
    buckets=(0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600),
    registry=REGISTRY,
)

INGESTION_JOBS_TOTAL = Counter(
    "ingestion_jobs_total",
    "Ingestion jobs by terminal status.",
    ["status"],
    registry=REGISTRY,
)

INGESTION_QUEUE_DEPTH = Gauge(
    "ingestion_queue_depth",
    "Pending messages on the ingestion queue.",
    ["queue"],
    registry=REGISTRY,
)

# ---------------------------------------------------------------------------
# Infrastructure / abuse
# ---------------------------------------------------------------------------
DB_POOL_IN_USE = Gauge(
    "db_pool_in_use",
    "Checked-out database connections.",
    registry=REGISTRY,
)

DB_POOL_SIZE = Gauge(
    "db_pool_size",
    "Configured database pool size plus overflow in use.",
    registry=REGISTRY,
)

RATE_LIMIT_BLOCKED_TOTAL = Counter(
    "rate_limit_blocked_total",
    "Requests rejected by the rate limiter.",
    ["scope"],
    registry=REGISTRY,
)

AUTH_FAILURES_TOTAL = Counter(
    "auth_failures_total",
    "Authentication failures by reason.",
    ["reason"],
    registry=REGISTRY,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def route_template(scope: Mapping[str, Any]) -> str:
    """Return the matched route template, or ``unmatched`` for 404s."""
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path or "unmatched"


def status_class(status_code: int) -> str:
    return f"{status_code // 100}xx"


def observe_http(
    *,
    method: str,
    route: str,
    status_code: int,
    duration_seconds: float,
    response_bytes: int | None,
) -> None:
    HTTP_REQUESTS_TOTAL.labels(
        method=method, route=route, status_class=status_class(status_code)
    ).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(method=method, route=route).observe(duration_seconds)
    if response_bytes is not None:
        HTTP_RESPONSE_SIZE_BYTES.labels(route=route).observe(response_bytes)


def observe_rag_stage(stage: str, duration_seconds: float) -> None:
    RAG_STAGE_DURATION_SECONDS.labels(stage=stage).observe(duration_seconds)


def record_rag_outcome(outcome: str) -> None:
    RAG_REQUESTS_TOTAL.labels(outcome=outcome).inc()


def observe_retrieval_candidates(stage: str, count: int) -> None:
    RETRIEVAL_CANDIDATES.labels(stage=stage).observe(count)


def observe_retrieval_top_score(score: float) -> None:
    RETRIEVAL_TOP_SCORE.observe(score)


def record_llm_tokens(model: str, input_tokens: int, output_tokens: int) -> None:
    if input_tokens:
        LLM_TOKENS_TOTAL.labels(model=model, direction="input").inc(input_tokens)
    if output_tokens:
        LLM_TOKENS_TOTAL.labels(model=model, direction="output").inc(output_tokens)


def record_llm_cost(model: str, cost_usd: float) -> None:
    if cost_usd > 0:
        LLM_COST_USD_TOTAL.labels(model=model).inc(cost_usd)


def observe_llm_ttft(model: str, seconds: float) -> None:
    LLM_TIME_TO_FIRST_TOKEN_SECONDS.labels(model=model).observe(seconds)


def observe_ingestion(extension: str, outcome: str, duration_seconds: float) -> None:
    INGESTION_DURATION_SECONDS.labels(extension=extension, outcome=outcome).observe(
        duration_seconds
    )
    INGESTION_JOBS_TOTAL.labels(status=outcome).inc()


def set_queue_depth(queue: str, depth: int) -> None:
    INGESTION_QUEUE_DEPTH.labels(queue=queue).set(depth)


def record_rate_limited(scope: str) -> None:
    RATE_LIMIT_BLOCKED_TOTAL.labels(scope=scope).inc()


def record_auth_failure(reason: str) -> None:
    AUTH_FAILURES_TOTAL.labels(reason=reason).inc()


def refresh_db_pool_metrics() -> None:
    """Publish connection-pool saturation before a scrape."""
    from app.db.session import engine  # — avoids an import cycle

    pool = engine.pool
    if not isinstance(pool, QueuePool):  # pragma: no cover - non-pooled engines
        return
    DB_POOL_IN_USE.set(pool.checkedout())
    DB_POOL_SIZE.set(pool.size() + pool.overflow())


def render_latest() -> tuple[bytes, str]:
    """Return the Prometheus exposition payload and its content type."""
    refresh_db_pool_metrics()
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
