"""
FIKRA AI — FastAPI application entry point.

Registers middleware, routes, error handlers, and lifespan events.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.hardening import CSRFOriginMiddleware, RequestSizeLimitMiddleware
from app.core.logging import configure_logging, get_logger
from app.core.metrics import record_rate_limited, render_latest
from app.core.middleware import (
    CorrelationIDMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
    app_exception_handler,
)
from app.core.rate_limit import RateSpec, check_rate_limit, parse_rate
from app.core.redis import close_shared_redis, ping_redis
from app.core.telemetry import setup_telemetry
from app.db.session import engine
from app.providers.embeddings import _get_model
from app.providers.reranker import preload_reranker
from app.providers.vector_store import close_qdrant_client, ensure_collection

# Initialize logging first, before anything else
configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan: startup and shutdown events.

    Startup:
    - Log configuration summary (no secrets)
    - Verify database connectivity
    - Verify Qdrant and create the vector collection if needed

    Shutdown:
    - Dispose connection pool and Qdrant client
    - Log shutdown
    """
    logger.info(
        "application_starting",
        name=settings.app_name,
        env=settings.app_env,
        debug=settings.debug,
        llm_provider=settings.llm_provider,
        primary_model=settings.active_llm_model,
    )

    # Verify database connection
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("database_connection_ok")
    except Exception as exc:
        logger.error("database_connection_failed", error=str(exc))
        raise

    # Verify the vector store and create its collection/payload indexes.
    # Retrieval cannot answer without it, so a failure is fatal just like DB.
    try:
        await ensure_collection()
        logger.info("qdrant_connection_ok", collection=settings.qdrant_collection)
    except Exception as exc:
        logger.error("qdrant_connection_failed", error=str(exc))
        raise

    # Verify Redis (Celery broker/cache). Non-fatal: ingestion falls back to
    # inline processing when Redis/Celery is unavailable.
    try:
        await ping_redis()
        logger.info("redis_connection_ok")
    except Exception as exc:
        logger.warning("redis_connection_failed", error=str(exc))

    # Pre-load the embedding model in a thread so first requests don't time out
    # The model is ~130MB and takes 5-30s to download/load on first use
    logger.info("preloading_embedding_model", model=settings.embedding_model)
    try:
        await asyncio.to_thread(_get_model)
        logger.info("embedding_model_ready")
    except Exception as exc:
        logger.warning("embedding_model_preload_failed", error=str(exc))
        # Non-fatal — model will load lazily on first request

    # Pre-load the reranker for the same reason: otherwise the first chat pays
    # its multi-second load cost. Non-fatal when reranking is disabled.
    if settings.reranker_enabled:
        logger.info("preloading_reranker_model", model=settings.reranker_model)
        try:
            await asyncio.to_thread(preload_reranker)
            logger.info("reranker_model_ready")
        except Exception as exc:
            logger.warning("reranker_model_preload_failed", error=str(exc))

    yield

    logger.info("application_shutting_down")

    await close_shared_redis()
    await close_qdrant_client()
    await engine.dispose()


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        description="Production-Grade Multi-Tenant RAG Chatbot",
        version="0.1.0",
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url="/api/redoc" if not settings.is_production else None,
        openapi_url="/api/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # Middleware ordering matters and is easy to get backwards: Starlette
    # applies middleware in *reverse* registration order, so the last one added
    # is the outermost. Registration below is therefore innermost-first:
    #
    #   rate limit → CSRF → body size → security headers → access log
    #              → correlation ID → CORS
    #
    # which executes as CORS → correlation → access log → security headers →
    # body size → CSRF → rate limit → route. This guarantees that a rejection
    # (413/403/429) is still logged, counted in Prometheus, carries the request
    # ID and gets security/CORS headers, and that the access log can read the
    # request ID the correlation layer stored.
    #
    # Rate limiting on abuse-prone endpoints (brute force, LLM cost abuse,
    # disk-fill via uploads). Answers 429 with the same JSON error envelope as
    # AppError responses.
    if settings.rate_limit_enabled:
        rate_policies: tuple[tuple[str, tuple[str, ...], RateSpec], ...] = (
            (
                "/api/v1/auth/password-reset",
                ("POST",),
                parse_rate(settings.rate_limit_password_reset),
            ),
            ("/api/v1/auth/login", ("POST",), parse_rate(settings.rate_limit_login)),
            ("/api/v1/auth/register", ("POST",), parse_rate(settings.rate_limit_login)),
            ("/api/v1/auth/refresh", ("POST",), parse_rate(settings.rate_limit_login)),
            # Unauthenticated write: an access request creates rows and notifies
            # admins, so it is throttled like a login attempt.
            ("/api/v1/access-requests", ("POST",), parse_rate(settings.rate_limit_login)),
            ("/api/v1/chat/ask", ("POST",), parse_rate(settings.rate_limit_chat)),
            ("/api/v1/chat/conversations", ("POST",), parse_rate(settings.rate_limit_chat)),
            ("/api/v1/chat/feedback", ("POST",), parse_rate(settings.rate_limit_chat)),
            ("/api/v1/chat/messages/", ("POST",), parse_rate(settings.rate_limit_chat)),
            ("/api/v1/chat/favorites", ("POST",), parse_rate(settings.rate_limit_chat)),
            # Upload and reindex both consume disk and CPU; upload is listed
            # first because the loop stops at the first matching prefix.
            ("/api/v1/documents/upload", ("POST",), parse_rate(settings.rate_limit_upload)),
            ("/api/v1/documents/", ("POST",), parse_rate(settings.rate_limit_upload)),
        )

        @app.middleware("http")
        async def rate_limit_middleware(
            request: Request,
            call_next: Callable[..., Awaitable[Response]],
        ) -> Response:
            path = request.url.path
            for prefix, methods, spec in rate_policies:
                if path.startswith(prefix) and request.method in methods:
                    client_ip = request.client.host if request.client else "unknown"
                    allowed, retry_after = await check_rate_limit(f"{prefix}:{client_ip}", spec)
                    if not allowed:
                        logger.warning(
                            "rate_limit_hit",
                            path=path,
                            client_ip=client_ip,
                            limit=f"{spec.max_events}/{spec.period_seconds}s",
                        )
                        record_rate_limited(prefix)
                        return JSONResponse(
                            status_code=429,
                            headers={"Retry-After": str(retry_after)},
                            content={
                                "error": {
                                    "code": "RATE_LIMITED",
                                    "message": "Too many requests. Please try again later.",
                                    "request_id": getattr(request.state, "request_id", "unknown"),
                                }
                            },
                        )
                    break
            return await call_next(request)

    # Body-size and CSRF guards. Registered before the security/logging layers
    # so they run after them, and after the rate limiter so they run before it:
    # a 413/403 is logged, metered and carries the request ID, and an oversized
    # body is refused before the rate limiter does any work.
    app.add_middleware(CSRFOriginMiddleware)
    app.add_middleware(RequestSizeLimitMiddleware)

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(CorrelationIDMiddleware)

    # CORS — restrict in production to known origins. Registered last so it is
    # the outermost layer: preflights and error responses keep their headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    # Exception handler for all AppError subclasses
    app.add_exception_handler(AppError, app_exception_handler)
    app.add_exception_handler(Exception, app_exception_handler)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Return the shared error envelope for 422s instead of FastAPI's default.

        The default body (``{"detail": [...]}``) breaks clients that only know
        the ``error`` envelope, and it echoes the raw input value back.
        """
        errors = [
            {
                "field": ".".join(str(part) for part in err.get("loc", ()) if part != "body"),
                "message": err.get("msg", "Invalid value."),
                "type": err.get("type", "value_error"),
            }
            for err in exc.errors()
        ]
        logger.info("request_validation_failed", errors=len(errors))
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed.",
                    "request_id": getattr(request.state, "request_id", "unknown"),
                    "details": errors,
                }
            },
        )

    # Prometheus exposition. Deliberately outside /api/v1 and outside auth so a
    # scraper needs no credentials; it must be network-restricted in production.
    if settings.metrics_enabled:

        @app.get("/metrics", include_in_schema=False)
        async def metrics() -> Response:
            payload, content_type = render_latest()
            return Response(content=payload, media_type=content_type)

    # Routes
    app.include_router(api_router)

    # Optional OTLP tracing (no-op unless OTEL_ENABLED=true).
    setup_telemetry(app)

    return app


app = create_app()
