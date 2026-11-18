"""Tracing and stage timing helpers.

Two concerns live here, deliberately separated:

1. **Stage timing** — ``stage_span`` is always on. It records every RAG stage
   into the Prometheus histogram so a slow answer can be attributed to
   embedding, vector search, reranking, prompt building or the LLM call without
   a tracing backend. This is the cheapest possible instrumentation and it is
   what the latency SLOs are measured against.
2. **Distributed tracing** — opt-in via ``OTEL_ENABLED=true``. When enabled we
   export spans over OTLP; when disabled the instrumentation is never imported
   so there is no runtime cost in development.

The OpenTelemetry imports are lazy on purpose: the exporter packages are an
optional dependency, and a missing exporter must degrade to "metrics only"
rather than crash application startup.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

from app.core.config import settings
from app.core.logging import get_logger
from app.core.metrics import observe_rag_stage

if TYPE_CHECKING:  # pragma: no cover - typing only
    from fastapi import FastAPI

logger = get_logger(__name__)

_tracer: Any | None = None


def _get_tracer() -> Any | None:
    """Return an OTel tracer when tracing is enabled, else ``None``."""
    global _tracer
    if not settings.otel_enabled:
        return None
    if _tracer is None:
        try:
            from opentelemetry import trace  # noqa: PLC0415

            _tracer = trace.get_tracer(settings.app_name)
        except Exception as exc:  # pragma: no cover - optional dependency
            logger.warning("otel_tracer_unavailable", error=str(exc))
            return None
    return _tracer


@contextmanager
def stage_span(stage: str, **attributes: Any) -> Iterator[None]:
    """Time one RAG stage and record it.

    Usage::

        with stage_span("vector_search"):
            rows = await _vector_search(...)

    The metric is recorded even when the stage raises, which is what makes a
    failing stage visible in the same histogram as a slow one.
    """
    tracer = _get_tracer()
    span_cm: Any = None
    if tracer is not None:
        try:
            span_cm = tracer.start_as_current_span(f"rag.{stage}")
            span = span_cm.__enter__()
            for key, value in attributes.items():
                span.set_attribute(key, value)
        except Exception:  # pragma: no cover - tracing must never break a request
            span_cm = None

    start = time.perf_counter()
    try:
        yield
    finally:
        observe_rag_stage(stage, time.perf_counter() - start)
        if span_cm is not None:
            try:
                span_cm.__exit__(None, None, None)
            except Exception:  # pragma: no cover
                pass


def setup_telemetry(app: FastAPI) -> None:
    """Wire OTLP export + auto-instrumentation when tracing is enabled.

    Safe to call unconditionally: with ``OTEL_ENABLED`` false it returns
    immediately and imports nothing.
    """
    if not settings.otel_enabled:
        return

    try:
        from opentelemetry import trace  # noqa: PLC0415
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: PLC0415
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # noqa: PLC0415
        from opentelemetry.sdk.resources import Resource  # noqa: PLC0415
        from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
        from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: PLC0415

        resource = Resource.create(
            {
                "service.name": settings.app_name,
                "deployment.environment": settings.app_env,
            }
        )
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)

        FastAPIInstrumentor.instrument_app(
            app, excluded_urls="/metrics,/api/v1/health/.*"
        )

        try:
            from opentelemetry.instrumentation.sqlalchemy import (  # noqa: PLC0415
                SQLAlchemyInstrumentor,
            )

            from app.db.session import engine  # noqa: PLC0415

            SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
        except Exception as exc:  # pragma: no cover - optional
            logger.warning("otel_sqlalchemy_instrumentation_failed", error=str(exc))

        logger.info("otel_tracing_enabled")
    except Exception as exc:  # pragma: no cover - exporter missing in dev
        logger.warning("otel_setup_failed", error=str(exc))
