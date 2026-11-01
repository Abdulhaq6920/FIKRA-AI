"""
Structured JSON logging configuration using structlog.

Every log event includes:
- timestamp (ISO 8601 UTC)
- level
- logger name
- correlation_id (set per request via middleware)
- Additional context added by callers

Never log passwords, API keys, tokens, or raw document content.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, Processor

from app.core.config import settings

# Shared context variable — set per-request in middleware
_CONTEXT_VAR_NAME = "request_context"


def add_app_info(logger: Any, method: str, event_dict: EventDict) -> EventDict:  # noqa: ANN401
    """Inject application-level metadata into every log event."""
    event_dict.setdefault("app", settings.app_name)
    event_dict.setdefault("env", settings.app_env)
    return event_dict


def drop_color_message_key(logger: Any, method: str, event_dict: EventDict) -> EventDict:  # noqa: ANN401
    """Remove uvicorn's color_message field which duplicates 'message'."""
    event_dict.pop("color_message", None)
    return event_dict


def configure_logging() -> None:
    """
    Configure structlog and the standard library logging to emit
    structured JSON or pretty console logs depending on settings.

    Call once at application startup (main.py lifespan).
    """
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        add_app_info,
        drop_color_message_key,
        structlog.processors.StackInfoRenderer(),
    ]

    if settings.log_format == "json":
        processors: list[Processor] = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]
    else:
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        cache_logger_on_first_use=True,
    )

    # Bridge standard library logging into structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=settings.log_level.upper(),
    )
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "celery", "sqlalchemy.engine"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True


def get_logger(name: str = __name__) -> structlog.BoundLogger:
    """Return a bound structlog logger for the given module name."""
    return structlog.get_logger(name)
