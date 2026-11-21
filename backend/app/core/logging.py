"""
Structured JSON logging with console and rotating file sinks.

Every log event includes:
- timestamp (ISO 8601 UTC)
- level
- logger name
- correlation_id (set per request via middleware)
- Additional context added by callers

Logs are written to stdout **and** to a process-safe rotating file under
``LOG_DIR`` (``logs/`` by default). The active file is ``LOG_FILE``
(``app.logs`` for both the API and Celery worker). Once it reaches
``LOG_FILE_MAX_BYTES`` (20 MB by default), a cross-process lock rotates it into
``app.logs.1``, ``app.logs.2`` … up to ``LOG_FILE_BACKUP_COUNT`` (10) files. The
oldest backup is discarded and the active file starts fresh, so rotation wraps
without unbounded disk growth. Both sinks share the same processor chain, so
redaction and correlation IDs apply equally to console and disk.

Never log passwords, API keys, tokens, or raw document content.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from threading import Lock
from typing import Any, cast

import structlog
from concurrent_log_handler import ConcurrentRotatingFileHandler
from structlog.types import EventDict, Processor

from app.core.config import settings

# Shared context variable name — set per-request in middleware
_CONTEXT_VAR_NAME = "request_context"

# Keys whose values must never reach a log sink. Matched case-insensitively at
# the top level and one level down (nested dicts such as headers or payloads).
_SENSITIVE_KEYS = frozenset(
    {
        "password",
        "new_password",
        "current_password",
        "hashed_password",
        "password_reset_token",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "set-cookie",
        "api_key",
        "groq_api_key",
        "secret",
        "secret_key",
        "jwt_secret_key",
        "content",
    }
)

_REDACTED = "[REDACTED]"

# configure_logging() runs at import time (main.py) and may be called again by
# tests or a worker bootstrap; serialise it so two threads never install
# competing handler sets.
_config_lock = Lock()
_configured = False


def redact_sensitive(logger: Any, method: str, event_dict: EventDict) -> EventDict:
    """Replace credential-bearing values before anything is rendered."""
    for key in list(event_dict):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = _REDACTED
            continue
        value = event_dict[key]
        if isinstance(value, dict) and any(k.lower() in _SENSITIVE_KEYS for k in value):
            event_dict[key] = {
                nested_key: (_REDACTED if nested_key.lower() in _SENSITIVE_KEYS else nested_value)
                for nested_key, nested_value in value.items()
            }
    return event_dict


def add_app_info(logger: Any, method: str, event_dict: EventDict) -> EventDict:
    """Inject application-level metadata into every log event."""
    event_dict.setdefault("app", settings.app_name)
    event_dict.setdefault("env", settings.app_env)
    return event_dict


def drop_color_message_key(logger: Any, method: str, event_dict: EventDict) -> EventDict:
    """Remove uvicorn's color_message field which duplicates 'message'."""
    event_dict.pop("color_message", None)
    return event_dict


def _shared_processors() -> list[Processor]:
    """Processors used both by structlog events and foreign (stdlib) records."""
    return [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        add_app_info,
        redact_sensitive,
        drop_color_message_key,
        structlog.processors.StackInfoRenderer(),
    ]


def _formatter(processors: list[Processor]) -> structlog.stdlib.ProcessorFormatter:
    """Render structured events for both console and rotating file handlers."""
    renderer: Processor
    if settings.log_format == "json":
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=False)
    return structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )


def _file_handler() -> logging.Handler | None:
    """Create the process-safe rotating file sink, or None if unavailable.

    ``ConcurrentRotatingFileHandler`` coordinates rollover through a lock file,
    so the API and Celery workers can safely append to the same ``app.logs``.
    A read-only filesystem must not take the API down: console logging stays
    active and the reason is printed to stderr (logging is not wired yet here).
    """
    try:
        log_dir = Path(settings.log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        return ConcurrentRotatingFileHandler(
            filename=log_dir / settings.log_file,
            maxBytes=settings.log_file_max_bytes,
            backupCount=settings.log_file_backup_count,
            encoding="utf-8",
            keep_file_open=True,
        )
    except OSError as exc:
        message = f"cannot open log file {settings.log_dir}/{settings.log_file}: {exc}\n"
        sys.stderr.write(message)
        return None


def configure_logging(*, force: bool = False) -> None:
    """
    Configure structlog and standard library logging.

    Both the console and the rotating file sink share one processor chain, so
    JSON/console formatting, redaction and request correlation are identical.
    Call once at application startup (main.py imports and calls this); the
    Celery worker reuses the same configuration.

    Args:
        force: reinstall handlers even if logging was already configured.
            Used by tests that need a temporary log directory.
    """
    global _configured

    with _config_lock:
        if _configured and not force:
            return

        shared = _shared_processors()
        structlog.configure(
            processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
            logger_factory=structlog.stdlib.LoggerFactory(),
            wrapper_class=structlog.make_filtering_bound_logger(
                int(getattr(logging, settings.log_level.upper(), logging.INFO))
            ),
            context_class=dict,
            cache_logger_on_first_use=True,
        )

        formatter = _formatter(shared)
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        handlers: list[logging.Handler] = [console]

        if settings.log_to_file:
            file_sink = _file_handler()
            if file_sink is not None:
                file_sink.setFormatter(formatter)
                handlers.append(file_sink)

        # force=True removes and closes handlers installed by an earlier call
        # (or by a library that configured logging before us).
        logging.basicConfig(
            handlers=handlers,
            level=settings.log_level.upper(),
            force=True,
        )

        # Let uvicorn/celery/sqlalchemy records flow through our handlers and
        # processor chain instead of writing their own unstructured format.
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "celery", "sqlalchemy.engine"):
            named = logging.getLogger(name)
            named.handlers = []
            named.propagate = True

        _configured = True


def get_logger(name: str = __name__) -> structlog.BoundLogger:
    """Return a bound structlog logger for the given module name."""
    # structlog.get_logger is typed as returning Any (the concrete type depends
    # on the configured wrapper class).
    return cast("structlog.BoundLogger", structlog.get_logger(name))
