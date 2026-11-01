"""
FIKRA AI — FastAPI application entry point.

Registers middleware, routes, error handlers, and lifespan events.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
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
        primary_model=settings.groq_primary_model,
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

    # Exception handler for all AppError subclasses
    app.add_exception_handler(AppError, app_exception_handler)
    app.add_exception_handler(Exception, app_exception_handler)

    # Routes
    app.include_router(api_router)

    return app


app = create_app()
