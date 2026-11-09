"""
FastAPI middleware stack.

Registered in main.py in this order:
1. CorrelationIDMiddleware  — attaches a unique request ID to every request
2. RequestLoggingMiddleware — structured access log per request
3. SecurityHeadersMiddleware — OWASP-recommended response headers
4. ExceptionHandlerMiddleware — translates AppError subclasses to JSON

All outbound error responses use a consistent envelope:
{
    "error": {
        "code":    "ERROR_CODE",
        "message": "Human-readable description (safe for clients)",
        "request_id": "uuid"
    }
}
"""

from __future__ import annotations

import time
import uuid
from typing import Awaitable, Callable

import structlog
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.exceptions import AppError
from app.core.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Correlation ID middleware
# ---------------------------------------------------------------------------
_CORRELATION_HEADER = "X-Request-ID"


class CorrelationIDMiddleware(BaseHTTPMiddleware):
    """Attach a unique request ID to each request for log correlation."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get(_CORRELATION_HEADER, str(uuid.uuid4()))
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers[_CORRELATION_HEADER] = request_id
        return response


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log each HTTP request/response with method, path, status, and latency."""

    _SKIP_PATHS = {"/health/live", "/health/ready", "/metrics"}

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path in self._SKIP_PATHS:
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

        logger.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=elapsed_ms,
            client_ip=request.client.host if request.client else None,
        )
        return response


# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add OWASP-recommended security headers to every response."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none';"
        # Remove headers that leak server information
        if "server" in response.headers:
            del response.headers["server"]
        if "x-powered-by" in response.headers:
            del response.headers["x-powered-by"]
        return response


# ---------------------------------------------------------------------------
# Global exception handler (registered on the FastAPI app, not as middleware)
# ---------------------------------------------------------------------------
async def app_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Translate AppError subclasses into consistent JSON error responses.
    Any unhandled exception becomes a generic 500 — never exposing internals.
    """
    request_id = request.headers.get(_CORRELATION_HEADER, "unknown")

    if isinstance(exc, AppError):
        log = logger.warning if exc.status_code < 500 else logger.error
        log(
            "app_error",
            error_code=exc.error_code,
            status_code=exc.status_code,
            message=exc.message,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.error_code,
                    "message": exc.message,
                    "request_id": request_id,
                }
            },
        )

    # Unexpected exceptions — log with traceback, return generic 500
    logger.exception("unhandled_exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred.",
                "request_id": request_id,
            }
        },
    )
