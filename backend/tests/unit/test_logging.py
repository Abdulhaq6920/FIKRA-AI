"""Unit tests for structured logging, redaction and rotating file sinks."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from app.core.config import settings
from app.core.logging import configure_logging, get_logger, redact_sensitive


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
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(log_dir.iterdir()))


def test_rotating_file_sink_writes_json_and_rotates(log_dir: Path) -> None:
    logger = get_logger("test.logging")
    for index in range(25):
        logger.info("rotation_probe", index=index)

    text = _all_log_text(log_dir)
    names = sorted(path.name for path in log_dir.iterdir())

    assert "test.log" in names
    assert any(name.startswith("test.log.") for name in names), names
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
