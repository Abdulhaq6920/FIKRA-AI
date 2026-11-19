"""
Maintenance tasks for the Celery worker.

These run on a beat schedule and keep ingestion healthy when workers die or
tasks leak. They share the same async event-loop helper pattern as
``document_tasks`` so a single loop is reused across retries.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar

from celery import Task

from app.core.logging import get_logger
from app.workers.celery_app import celery_app

logger = get_logger(__name__)

# How long a document may sit in PROCESSING before the reconciler treats it as
# stuck. Workers normally finish in seconds; 30 minutes is generous headroom for
# a 200-page scanned PDF.
_STUCK_AFTER_MINUTES = 30

_worker_loop: asyncio.AbstractEventLoop | None = None
_worker_loop_lock = threading.Lock()

_T = TypeVar("_T")


def _get_worker_loop() -> asyncio.AbstractEventLoop:
    global _worker_loop
    with _worker_loop_lock:
        if _worker_loop is None or _worker_loop.is_closed():
            _worker_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(_worker_loop)
        return _worker_loop


class _BaseTask(Task):  # type: ignore[misc]  # celery ships no type information
    """Base class that runs the async reconciliation on the worker loop."""

    def _run_async(self, coro: Coroutine[Any, Any, _T]) -> _T:
        return _get_worker_loop().run_until_complete(coro)


@celery_app.task(  # type: ignore[misc]  # celery ships no type information
    bind=True,
    base=_BaseTask,
    name="app.workers.maintenance_tasks.reconcile_stuck_documents",
    acks_late=True,
)
def reconcile_stuck_documents(self: _BaseTask) -> dict[str, Any]:
    """
    Mark documents stuck in PROCESSING as FAILED.

    A document left in PROCESSING after a worker crash or a lost task never
    self-heals: the chunks are never written, the status never changes, and the
    document is effectively lost to retrieval. This task finds any document
    (and its newest job) still in PROCESSING after ``STUCK_DOCUMENT_MINUTES``
    and marks both as FAILED with an explanatory error.

    Idempotent: re-running is safe — a document already marked FAILED or READY
    is skipped.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=_STUCK_AFTER_MINUTES)

    try:
        result = self._run_async(_reconcile(cutoff))
        logger.info(
            "reconciliation_complete",
            cutoff=cutoff.isoformat(),
            marked_failed=result.get("marked_failed", 0),
        )
        return result
    except Exception as exc:  # pragma: no cover - maintenance must not crash the beat
        logger.error("reconciliation_failed", error=str(exc)[:200])
        return {"status": "error", "error": str(exc)[:256]}


async def _reconcile(cutoff: datetime) -> dict[str, Any]:
    """Async body: find and fail stuck documents."""
    from sqlalchemy import select

    from app.db.models.document import Document, DocumentProcessingJob, DocumentStatus, JobStatus
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        stuck = (
            await db.scalars(
                select(Document).where(
                    Document.status == DocumentStatus.PROCESSING,
                    Document.updated_at < cutoff,
                )
            )
        ).all()

        marked = 0
        for doc in stuck:
            # Fail the document.
            doc.status = DocumentStatus.FAILED

            # Fail its newest job row so the audit trail explains why.
            job = (
                await db.scalars(
                    select(DocumentProcessingJob)
                    .where(DocumentProcessingJob.document_id == doc.id)
                    .order_by(DocumentProcessingJob.created_at.desc())
                    .limit(1)
                )
            ).first()
            if job:
                job.status = JobStatus.DEAD
                job.error_type = "StuckDocument"
                job.error_message = (
                    f"No worker progress for {_STUCK_AFTER_MINUTES} minutes; "
                    "marked failed by the maintenance reconciler"
                )
                job.completed_at = datetime.now(UTC)

            marked += 1

        await db.commit()

    return {"status": "ok", "marked_failed": marked, "cutoff": cutoff.isoformat()}
