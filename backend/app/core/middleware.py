"""
FastAPI middleware stack.

Middleware are registered in main.py innermost-first (Starlette applies them in
reverse registration order), so a request executes through:

    CORS → CorrelationID → RequestLogging → SecurityHeaders → rate limit → route

- CorrelationIDMiddleware  — attaches a unique request ID to every request
- RequestLoggingMiddleware — structured access log + Prometheus metrics
- SecurityHeadersMiddleware — OWASP-recommended response headers
- ExceptionHandlerMiddleware — translates AppError subclasses to JSON

All outbound error responses use a consistent envelope:
{
    "error": {
        "code":    "ERROR_CODE",
        "message": "Human-readable description (safe for clients)",
        "request_id": "uuid"
    }
}

The request ID is the join key across the three signals: it is set on
``request.state``, bound into structlog contextvars, returned in the
``X-Request-ID`` response header, and (when OTel is enabled) attached to the
active span. A client-supplied value is accepted only when it matches
``^[A-Za-z0-9-]{8,64}$`` so log-injection and unbounded values are impossible.
"""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import ClassVar

import structlog
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging import get_logger
from app.core.metrics import observe_http, route_template

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Correlation ID middleware
# ---------------------------------------------------------------------------
_CORRELATION_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def resolve_request_id(request: Request) -> str:
    """Return a trusted request ID: the client's if well-formed, else a new UUID."""
    incoming = request.headers.get(_CORRELATION_HEADER, "")
    if _VALID_REQUEST_ID.match(incoming):
        return incoming
    return str(uuid.uuid4())


class CorrelationIDMiddleware(BaseHTTPMiddleware):
    """Attach a unique request ID to each request for log/trace correlation."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = resolve_request_id(request)
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers[_CORRELATION_HEADER] = request_id
        return response


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log each request and record its latency, status class and payload size."""

    # Probes and the scrape endpoint are high-frequency and low-information.
    # Paths here are the real, fully-prefixed paths the client requests.
    _SKIP_PATHS: ClassVar[set[str]] = {
        "/api/v1/health/live",
        "/api/v1/health/ready",
        "/api/v1/health/startup",
        "/metrics",
    }

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path = request.url.path
        if path in self._SKIP_PATHS:
            return await call_next(request)

        start = time.perf_counter()
        status_code = 500
        response_bytes: int | None = None
        try:
            response = await call_next(request)
            status_code = response.status_code
            content_length = response.headers.get("content-length")
            if content_length is not None and content_length.isdigit():
                response_bytes = int(content_length)
            return response
        finally:
            elapsed_seconds = time.perf_counter() - start
            elapsed_ms = round(elapsed_seconds * 1000, 2)
            route = route_template(request.scope)
            request_id = getattr(request.state, "request_id", None)

            observe_http(
                method=request.method,
                route=route,
                status_code=status_code,
                duration_seconds=elapsed_seconds,
                response_bytes=response_bytes,
            )

            # The correlation middleware runs *inside* this one (Starlette
            # applies middleware in reverse registration order), so its
            # contextvars are not visible here. Re-bind from request.state so
            # the access line still carries the same ID as the response header.
            if request_id:
                structlog.contextvars.bind_contextvars(request_id=request_id)

            fields = {
                "request_id": request_id,
                "method": request.method,
                "path": path,
                "route": route,
                "status_code": status_code,
                "duration_ms": elapsed_ms,
                "response_bytes": response_bytes,
                "client_ip": request.client.host if request.client else None,
                "user_id": getattr(request.state, "user_id", None),
                "org_id": getattr(request.state, "org_id", None),
            }
            if settings.slow_request_ms and elapsed_ms >= settings.slow_request_ms:
                logger.warning("http_request_slow", **fields)
            else:
                logger.info("http_request", **fields)


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

    The request ID is read from ``request.state`` — the same value the
    CorrelationIDMiddleware bound into the logs and returned in the header — so
    the body, the header and the log line always agree.
    """
    request_id = getattr(request.state, "request_id", None) or "unknown"

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
