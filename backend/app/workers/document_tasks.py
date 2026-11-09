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
import uuid
from datetime import datetime, timezone

from celery import Task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded

from app.core.logging import get_logger
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


class _BaseTask(Task):
    """
    Base class that provides a synchronous DB session for Celery tasks.
    Celery workers are synchronous; we run async code in an event loop.
    """

    _loop: asyncio.AbstractEventLoop | None = None

    def _run_async(self, coro: object) -> object:
        """Run an async coroutine synchronously in the worker process."""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)  # type: ignore[arg-type]


@celery_app.task(
    bind=True,
    base=_BaseTask,
    name="app.workers.document_tasks.ingest_document",
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def ingest_document(self: _BaseTask, document_id: str, organization_id: str) -> dict:
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

    logger.info(
        "ingestion_task_started",
        document_id=document_id,
        org_id=organization_id,
        attempt=self.request.retries + 1,
    )

    try:
        result = self._run_async(_run_ingestion(doc_id, org_id, self.request.id))
        logger.info(
            "ingestion_task_complete",
            document_id=document_id,
            chunks=result.get("chunk_count"),
        )
        return result

    except SoftTimeLimitExceeded:
        logger.error("ingestion_task_timeout", document_id=document_id)
        self._run_async(_mark_failed(doc_id, org_id, "TimeoutError", "Processing timed out"))
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

        try:
            # Retry with exponential back-off
            raise self.retry(exc=exc, countdown=60 * (2**self.request.retries))
        except MaxRetriesExceededError:
            self._run_async(_mark_failed(doc_id, org_id, error_type, error_msg))
            return {"status": "dead", "error": error_msg}


async def _run_ingestion(
    document_id: uuid.UUID,
    organization_id: uuid.UUID,
    celery_task_id: str,
) -> dict:
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
            return {"status": "deleted", "chunk_count": 0}

        # Mark job as running
        job = await db.scalar(
            select(DocumentProcessingJob).where(
                DocumentProcessingJob.document_id == document_id,
                DocumentProcessingJob.organization_id == organization_id,
            )
        )
        if job:
            job.status = JobStatus.RUNNING
            job.celery_task_id = celery_task_id
            job.started_at = datetime.now(timezone.utc)

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
            return {"status": "deleted", "chunk_count": 0}
        doc = current_doc

        # Delete existing chunks (safe reindex)
        from sqlalchemy import delete

        await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))

        # Insert new chunks
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
                embedding=cd.embedding,
            )
            db.add(chunk)

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
            job.completed_at = datetime.now(timezone.utc)

        await db.commit()

    return {"status": "ready", "chunk_count": len(chunks_data)}


def settings_import():
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
            select(DocumentProcessingJob).where(
                DocumentProcessingJob.document_id == document_id,
                DocumentProcessingJob.organization_id == organization_id,
            )
        )
        if job:
            job.status = JobStatus.DEAD
            job.error_type = error_type
            job.error_message = error_message[:256]
            job.completed_at = datetime.now(timezone.utc)

        await db.commit()
