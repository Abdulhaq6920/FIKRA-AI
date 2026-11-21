"""
Celery tasks for document ingestion.

Flow:
    ingest_document(document_id, organization_id)
        → load file from storage
        → extract text
        → chunk text
        → embed chunks
        → save chunks to database
        → update document status

Idempotency:
- Tasks check the document's current status before doing work.
- Re-running a completed task is safe (existing chunks are deleted first).
- The organization_id is always verified against the database record
  to prevent a queued job from processing a document under a forged tenant.

Error handling:
- Transient errors are retried with exponential back-off.
- Permanent errors mark the job as DEAD and the document as FAILED.
- Raw exception tracebacks are logged but NOT stored in the user-visible DB.
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from collections.abc import Coroutine
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, TypeVar

from celery import Task
from celery.exceptions import SoftTimeLimitExceeded

from app.core.logging import get_logger
from app.core.metrics import observe_ingestion, set_queue_depth
from app.workers.celery_app import celery_app

if TYPE_CHECKING:
    from app.core.config import Settings

logger = get_logger(__name__)

# Celery workers are synchronous, but the pipeline is async. One loop per worker
# process is created lazily and reused: calling ``asyncio.get_event_loop()`` in a
# worker thread raises on Python 3.12, and creating a fresh loop per retry leaks
# file descriptors and asyncpg connections.
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
    """Base class that runs the async ingestion pipeline on the worker loop."""

    def _run_async(self, coro: Coroutine[Any, Any, _T]) -> _T:
        """Run an async coroutine synchronously in the worker process."""
        return _get_worker_loop().run_until_complete(coro)


def _refresh_queue_depth() -> None:
    """Sample pending ingestion messages so the gauge is never stale.

    Done inside the worker rather than by a beat schedule: it needs no extra
    process and the value is refreshed exactly when queue pressure matters.
    """
    try:
        from app.core.redis import queue_depths

        depths = _get_worker_loop().run_until_complete(queue_depths(("default", "ingestion")))
        for queue, depth in depths.items():
            set_queue_depth(queue, depth)
    except Exception as exc:  # pragma: no cover - observability must not fail a job
        logger.debug("queue_depth_refresh_failed", error=str(exc))


@celery_app.task(  # type: ignore[misc]  # celery ships no type information
    bind=True,
    base=_BaseTask,
    name="app.workers.document_tasks.ingest_document",
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def ingest_document(self: _BaseTask, document_id: str, organization_id: str) -> dict[str, Any]:
    """
    Full ingestion pipeline for a single document.

    Args:
        document_id:     UUID string of the document to process.
        organization_id: UUID string — verified against the database record.

    Returns:
        Dict with status and chunk count.
    """
    doc_id = uuid.UUID(document_id)
    org_id = uuid.UUID(organization_id)
    started = time.perf_counter()

    logger.info(
        "ingestion_task_started",
        document_id=document_id,
        org_id=organization_id,
        attempt=self.request.retries + 1,
    )
    _refresh_queue_depth()

    try:
        result = self._run_async(_run_ingestion(doc_id, org_id, self.request.id))
        outcome = str(result.get("status", "ready"))
        observe_ingestion(
            str(result.get("extension") or "unknown"),
            outcome,
            time.perf_counter() - started,
        )
        logger.info(
            "ingestion_task_complete",
            document_id=document_id,
            chunks=result.get("chunk_count"),
        )
        return result

    except SoftTimeLimitExceeded:
        logger.error("ingestion_task_timeout", document_id=document_id)
        self._run_async(_mark_failed(doc_id, org_id, "TimeoutError", "Processing timed out"))
        observe_ingestion("unknown", "timeout", time.perf_counter() - started)
        return {"status": "failed", "error": "timeout"}

    except Exception as exc:
        error_type = type(exc).__name__
        error_msg = str(exc)[:256]
        logger.error(
            "ingestion_task_error",
            document_id=document_id,
            error_type=error_type,
            error=error_msg,
            attempt=self.request.retries + 1,
        )

        # ``self.retry(exc=...)`` re-raises the *original* exception once the
        # retry budget is gone, so catching MaxRetriesExceededError here would
        # never run: the document would stay PROCESSING forever. Decide from
        # the retry counter instead.
        if self.request.retries >= self.max_retries:
            self._run_async(_mark_failed(doc_id, org_id, error_type, error_msg))
            observe_ingestion("unknown", "dead", time.perf_counter() - started)
            return {"status": "dead", "error": error_msg}

        raise self.retry(exc=exc, countdown=60 * (2**self.request.retries)) from exc


async def _run_ingestion(
    document_id: uuid.UUID,
    organization_id: uuid.UUID,
    celery_task_id: str,
) -> dict[str, Any]:
    """Async implementation of the ingestion pipeline."""
    from sqlalchemy import select

    from app.db.models.document import (
        Document,
        DocumentChunk,
        DocumentProcessingJob,
        DocumentStatus,
        JobStatus,
    )
    from app.db.session import AsyncSessionLocal
    from app.providers.embeddings import get_model_version
    from app.services.ingestion_service import chunk_text, embed_chunks, extract_text
    from app.storage.local_storage import get_storage

    async with AsyncSessionLocal() as db:
        # Load and verify document — organization_id check prevents cross-tenant processing
        doc = await db.scalar(
            select(Document).where(
                Document.id == document_id,
                Document.organization_id == organization_id,  # TENANT CHECK
            )
        )
        if doc is None:
            # A deletion can race a queued Celery task. The document and all
            # vector rows are gone by design, so treating this as a retryable
            # failure would recreate noisy dead-letter jobs.
            logger.info("ingestion_skipped_deleted_document", document_id=str(document_id))
            return {"status": "deleted", "chunk_count": 0, "extension": "unknown"}

        # Mark job as running
        job = await db.scalar(
            select(DocumentProcessingJob)
            .where(
                DocumentProcessingJob.document_id == document_id,
                DocumentProcessingJob.organization_id == organization_id,
            )
            # A document can have several historical jobs (re-index, retry).
            # Without an explicit order the "current" job is whichever row the
            # planner returns first, so progress updates could land on a job
            # that finished days ago.
            .order_by(DocumentProcessingJob.created_at.desc())
            .limit(1)
        )
        if job:
            job.status = JobStatus.RUNNING
            job.celery_task_id = celery_task_id
            job.started_at = datetime.now(UTC)

        doc.status = DocumentStatus.PROCESSING
        await db.commit()

        # Read file from storage
        storage = get_storage()
        file_bytes = await storage.read(doc.storage_path)

        # Extract text
        extraction = extract_text(file_bytes, doc.file_extension)

        # Chunk
        chunks_data = chunk_text(extraction)

        if not chunks_data:
            raise ValueError("Extraction produced no text chunks")

        # Embed
        chunks_data = embed_chunks(chunks_data)

        # Re-check immediately before writing: a user may have deleted the
        # document while a large file was being embedded.
        current_doc = await db.scalar(
            select(Document).where(
                Document.id == document_id,
                Document.organization_id == organization_id,
                Document.is_active == True,  # noqa: E712
            )
        )
        if current_doc is None:
            logger.info("ingestion_aborted_deleted_document", document_id=str(document_id))
            return {
                "status": "deleted",
                "chunk_count": 0,
                "extension": doc.file_extension,
            }
        doc = current_doc

        # Replace the old vector set together with the old relational chunks.
        # A reindex must not leave stale points pointing at deleted chunk IDs.
        from sqlalchemy import delete

        from app.providers.vector_store import (
            VectorPoint,
            delete_document_points,
            upsert_points,
        )

        await delete_document_points(document_id, organization_id)
        await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))

        # Insert new chunks and flush so their generated UUIDs are available as
        # Qdrant point IDs before the transaction is committed.
        new_chunks: list[DocumentChunk] = []
        for cd in chunks_data:
            chunk = DocumentChunk(
                document_id=document_id,
                organization_id=organization_id,
                content=cd.content,
                content_hash=cd.content_hash,
                chunk_index=cd.chunk_index,
                page_number=cd.page_number,
                section_heading=cd.section_heading,
                start_char=cd.start_char,
                end_char=cd.end_char,
                token_count=cd.token_count,
            )
            db.add(chunk)
            new_chunks.append(chunk)
        await db.flush()

        await upsert_points(
            [
                VectorPoint(
                    chunk_id=chunk.id,
                    document_id=document_id,
                    organization_id=organization_id,
                    embedding=cd.embedding,
                )
                for chunk, cd in zip(new_chunks, chunks_data, strict=True)
            ]
        )

        # Update document status
        doc.status = DocumentStatus.READY
        doc.page_count = extraction.page_count
        doc.word_count = extraction.word_count
        doc.extraction_warnings = extraction.warnings or None
        doc.chunk_count = len(chunks_data)
        doc.embedding_model = settings_import().embedding_model
        doc.embedding_model_version = get_model_version()

        if job:
            job.status = JobStatus.SUCCESS
            job.completed_at = datetime.now(UTC)

        await db.commit()

    return {"status": "ready", "chunk_count": len(chunks_data), "extension": doc.file_extension}


def settings_import() -> Settings:
    from app.core.config import settings

    return settings


async def _mark_failed(
    document_id: uuid.UUID,
    organization_id: uuid.UUID,
    error_type: str,
    error_message: str,
) -> None:
    """Mark a document and its job as permanently failed."""
    from sqlalchemy import select

    from app.db.models.document import Document, DocumentProcessingJob, DocumentStatus, JobStatus
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        doc = await db.scalar(
            select(Document).where(
                Document.id == document_id,
                Document.organization_id == organization_id,
            )
        )
        if doc:
            doc.status = DocumentStatus.FAILED

        job = await db.scalar(
            select(DocumentProcessingJob)
            .where(
                DocumentProcessingJob.document_id == document_id,
                DocumentProcessingJob.organization_id == organization_id,
            )
            .order_by(DocumentProcessingJob.created_at.desc())
            .limit(1)
        )
        if job:
            job.status = JobStatus.DEAD
            job.error_type = error_type
            job.error_message = error_message[:256]
            job.completed_at = datetime.now(UTC)

        await db.commit()
