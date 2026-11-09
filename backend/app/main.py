"""
FIKRA AI — FastAPI application entry point.

Registers middleware, routes, error handlers, and lifespan events.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, get_logger
from app.core.middleware import (
    CorrelationIDMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
    app_exception_handler,
)
from app.core.rate_limit import RateSpec, limiter, parse_rate

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

    Shutdown:
    - Dispose connection pool
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
    from app.db.session import engine
    from sqlalchemy import text

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("database_connection_ok")
    except Exception as exc:
        logger.error("database_connection_failed", error=str(exc))
        raise

    # Verify Redis (Celery broker/cache). Non-fatal: ingestion falls back to
    # inline processing when Redis/Celery is unavailable.
    from app.core.redis import ping_redis

    try:
        await ping_redis()
        logger.info("redis_connection_ok")
    except Exception as exc:
        logger.warning("redis_connection_failed", error=str(exc))

    # Pre-load the embedding model in a thread so first requests don't time out
    # The model is ~130MB and takes 5-30s to download/load on first use
    logger.info("preloading_embedding_model", model=settings.embedding_model)
    try:
        import asyncio as _asyncio
        from app.providers.embeddings import _get_model

        await _asyncio.to_thread(_get_model)
        logger.info("embedding_model_ready")
    except Exception as exc:
        logger.warning("embedding_model_preload_failed", error=str(exc))
        # Non-fatal — model will load lazily on first request

    yield

    logger.info("application_shutting_down")
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

    # CORS — restrict in production to known origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    # Custom middleware (order: outermost first)
    app.add_middleware(CorrelationIDMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    # Rate limiting on abuse-prone endpoints (brute force, LLM cost abuse,
    # disk-fill via uploads). Runs as middleware and answers 429 with the
    # same JSON error envelope as AppError responses.
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
            ("/api/v1/chat/ask", ("POST",), parse_rate(settings.rate_limit_chat)),
            ("/api/v1/documents/upload", ("POST",), parse_rate(settings.rate_limit_upload)),
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
                    allowed, retry_after = limiter.check(f"{prefix}:{client_ip}", spec)
                    if not allowed:
                        logger.warning(
                            "rate_limit_hit",
                            path=path,
                            client_ip=client_ip,
                            limit=f"{spec.max_events}/{spec.period_seconds}s",
                        )
                        return JSONResponse(
                            status_code=429,
                            headers={"Retry-After": str(retry_after)},
                            content={
                                "error": {
                                    "code": "RATE_LIMITED",
                                    "message": "Too many requests. Please try again later.",
                                    "request_id": request.headers.get("X-Request-ID", "unknown"),
                                }
                            },
                        )
                    break
            return await call_next(request)

    # Exception handler for all AppError subclasses
    app.add_exception_handler(AppError, app_exception_handler)
    app.add_exception_handler(Exception, app_exception_handler)

    # Routes
    app.include_router(api_router)

    return app


app = create_app()
