"""Request hardening middleware: body-size limits and CSRF origin checks.

Both concerns belong in middleware rather than in route handlers because they
must be decided *before* the request body is parsed or any handler runs:

* An oversized upload must be rejected from its ``Content-Length`` header alone.
  Validating size inside the upload handler (as it did before) means the server
  has already accepted and buffered the body — the expensive part — before
  deciding it is too big.
* A cross-site request must be rejected before a cookie-authenticated mutation
  reaches its handler.

Execution order (see ``main.create_app``) is::

    CORS → CorrelationID → RequestLogging → SecurityHeaders
         → RequestSizeLimit → CSRFOrigin → rate limit → route

so a rejection is still logged, counted and carries the request ID.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Cookies that authenticate a browser session. A Bearer token is never sent
# automatically by a browser, so requests carrying only ``Authorization`` are
# not CSRF-exposed and are exempt from the origin check.
_AUTH_COOKIES = ("access_token", "refresh_token")


def _error(status_code: int, code: str, message: str, request: Request) -> JSONResponse:
    """Return the shared error envelope, matching ``AppError`` responses."""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": getattr(request.state, "request_id", "unknown"),
            }
        },
    )


def _origin_of(value: str) -> str | None:
    """Normalise an ``Origin``/``Referer`` value to ``scheme://host[:port]``."""
    if not value:
        return None
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose declared body exceeds the upload limit with 413.

    Only the header is inspected, so the body is never read. Requests without a
    ``Content-Length`` (chunked transfer encoding) are left to the handler's
    streaming counter, which still enforces the same limit.
    """

    def __init__(self, app: object, *, max_bytes: int | None = None) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.max_bytes = settings.max_upload_size_bytes if max_bytes is None else max_bytes

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                declared = int(raw_length)
            except ValueError:
                return _error(
                    400,
                    "INVALID_CONTENT_LENGTH",
                    "The Content-Length header is not a valid integer.",
                    request,
                )
            if declared > self.max_bytes:
                logger.warning(
                    "request_body_too_large",
                    path=request.url.path,
                    declared_bytes=declared,
                    limit_bytes=self.max_bytes,
                )
                return _error(
                    413,
                    "PAYLOAD_TOO_LARGE",
                    f"Request body exceeds the {settings.max_upload_size_mb}MB limit.",
                    request,
                )
        return await call_next(request)


class CSRFOriginMiddleware(BaseHTTPMiddleware):
    """Reject cookie-authenticated unsafe requests from a foreign origin.

    Browsers attach cookies to cross-site requests, so without this check any
    page could trigger a state change as the logged-in user. The check is
    deliberately narrow:

    * safe methods pass through;
    * requests authenticated only by ``Authorization: Bearer`` pass (a browser
      will not add that header on an attacker's behalf);
    * a request is rejected only when it *does* carry ``Origin``/``Referer`` and
      that origin is neither an allowed origin nor the API's own origin.

    Allowing an absent ``Origin`` keeps non-browser clients working; browsers
    always send ``Origin`` on cross-site unsafe requests, so the gap is not
    reachable from a web page.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.method not in _UNSAFE_METHODS:
            return await call_next(request)

        if not any(request.cookies.get(name) for name in _AUTH_COOKIES):
            return await call_next(request)

        supplied = _origin_of(request.headers.get("origin", ""))
        if supplied is None:
            # Fall back to Referer; both absent means a non-browser client.
            supplied = _origin_of(request.headers.get("referer", ""))
        if supplied is None:
            return await call_next(request)

        allowed = {_origin_of(origin) for origin in settings.allowed_origins}
        allowed.add(_origin_of(str(request.base_url)))
        if supplied in allowed:
            return await call_next(request)

        logger.warning(
            "csrf_origin_rejected",
            path=request.url.path,
            method=request.method,
            origin=supplied,
        )
        return _error(
            403,
            "CSRF_ORIGIN_REJECTED",
            "Request origin is not allowed for this operation.",
            request,
        )
