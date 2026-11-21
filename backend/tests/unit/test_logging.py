"""Unit tests for structured logging, redaction and rotating file sinks."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from concurrent_log_handler import ConcurrentRotatingFileHandler

from app.core.config import Settings, settings
from app.core.logging import configure_logging, get_logger, redact_sensitive


def _log_files(log_dir: Path) -> list[Path]:
    """Return retained log files only, ignoring the rotation lock file."""
    return sorted(
        path for path in log_dir.iterdir() if path.is_file() and not path.name.endswith(".lock")
    )


@pytest.fixture
def log_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point logging at a temporary, aggressively small rotating file."""
    monkeypatch.setattr(settings, "log_to_file", True)
    monkeypatch.setattr(settings, "log_dir", str(tmp_path))
    monkeypatch.setattr(settings, "log_file", "test.log")
    monkeypatch.setattr(settings, "log_file_max_bytes", 512)
    monkeypatch.setattr(settings, "log_file_backup_count", 2)
    configure_logging(force=True)
    try:
        yield tmp_path
    finally:
        # Close the file handler before pytest removes tmp_path (Windows locks
        # open files), and leave other tests with a console-only configuration.
        monkeypatch.setattr(settings, "log_to_file", False)
        configure_logging(force=True)


def _all_log_text(log_dir: Path) -> str:
    for handler in logging.getLogger().handlers:
        handler.flush()
    return "\n".join(path.read_text(encoding="utf-8") for path in _log_files(log_dir))


def test_rotating_file_sink_writes_json_and_rotates(log_dir: Path) -> None:
    logger = get_logger("test.logging")
    for index in range(25):
        logger.info("rotation_probe", index=index)

    text = _all_log_text(log_dir)
    names = sorted(path.name for path in _log_files(log_dir))

    assert "test.log" in names
    assert {"test.log.1", "test.log.2"}.issubset(names), names
    # Only backupCount + 1 files are kept, so older events are intentionally
    # discarded; the newest event must still be present in the active file.
    assert '"index": 24' in (log_dir / "test.log").read_text(encoding="utf-8")
    # Every retained line is valid structured JSON, including rotated files.
    for line in text.splitlines():
        if line.strip():
            assert json.loads(line)["event"] == "rotation_probe"


def test_secrets_are_redacted_in_the_file_sink(log_dir: Path) -> None:
    get_logger("test.redaction").warning(
        "credential_probe",
        password="hunter2",  # noqa: S106 - deliberately fake test credential
        headers={"authorization": "Bearer super-secret", "x-trace": "kept"},
    )

    text = _all_log_text(log_dir)
    assert '"event": "credential_probe"' in text
    assert "hunter2" not in text
    assert "super-secret" not in text
    assert "kept" in text
    assert text.count("[REDACTED]") == 2


def test_redact_sensitive_handles_nested_payloads() -> None:
    event = {
        "password": "plain",
        "payload": {"refresh_token": "secret-value", "document_id": "keep-me"},
    }
    redact_sensitive(None, "info", event)
    assert event["password"] == "[REDACTED]"
    assert event["payload"]["refresh_token"] == "[REDACTED]"
    assert event["payload"]["document_id"] == "keep-me"


def test_default_log_rotation_settings() -> None:
    """Production defaults match the requested logs/app.logs 20 MB x 10 policy."""
    fields = Settings.model_fields
    assert fields["log_dir"].default == "logs"
    assert fields["log_file"].default == "app.logs"
    assert fields["log_file_max_bytes"].default == 20 * 1024 * 1024
    assert fields["log_file_backup_count"].default == 10


def test_file_sink_is_process_safe(log_dir: Path) -> None:
    """API and Celery must share one lock-coordinated rotating handler."""
    file_handlers = [
        handler
        for handler in logging.getLogger().handlers
        if isinstance(handler, logging.FileHandler)
    ]
    assert len(file_handlers) == 1
    assert isinstance(file_handlers[0], ConcurrentRotatingFileHandler)
